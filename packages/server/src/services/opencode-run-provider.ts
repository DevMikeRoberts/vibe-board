import { spawn, ChildProcess } from 'child_process';
import { v4 as uuid } from 'uuid';
import type { AgentProvider, AgentSession, AgentSessionConfig, AgentResult, AgentAttachment, AgentEvent } from '@codewithdan/agent-sdk-core';

interface OpenCodeRunProviderOptions {
  command?: string;
  model?: string;
}

export class OpenCodeRunProvider implements AgentProvider {
  readonly name = 'opencode' as const;
  readonly displayName = 'OpenCode';
  readonly model: string;

  constructor(options?: OpenCodeRunProviderOptions) {
    this.model = options?.model || process.env.OPENCODE_MODEL || 'configured default';
  }

  async start(): Promise<void> {
    // no-op: no persistent server needed
  }

  async stop(): Promise<void> {
    // no-op: nothing to clean up
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    return new OpenCodeRunSession(config, this.model);
  }
}

class OpenCodeRunSession implements AgentSession {
  private process: ChildProcess | null = null;
  private destroyed = false;
  private resolved = false;
  private command: string;
  private lastSessionId: string | null = null;
  private model: string;

  constructor(private config: AgentSessionConfig, model: string) {
    this.command = process.env.OPENCODE_COMMAND || 'opencode';
    this.model = model;
  }

  get sessionId(): string | null {
    return this.lastSessionId;
  }

  async execute(prompt: string, _attachments?: AgentAttachment[]): Promise<AgentResult> {
    if (this.destroyed) return { status: 'failed', error: 'Session destroyed' };

    const fullPrompt = this.config.systemPrompt
      ? `${this.config.systemPrompt}\n\n${prompt}`
      : prompt;

    const args = this.buildArgs(fullPrompt, false);
    return this.spawnProcess(args);
  }

  async send(message: string, _attachments?: AgentAttachment[]): Promise<void> {
    if (this.destroyed) return;

    const args = this.buildArgs(message, true);
    await this.spawnProcess(args);
  }

  async abort(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
        }
      }, 2000);
      this.process = null;
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.abort();
  }

  private buildArgs(prompt: string, isFollowUp: boolean): string[] {
    const args: string[] = [];

    // Global options (valid before subcommand)
    if (isFollowUp && this.lastSessionId) {
      args.push('--session', this.lastSessionId, '--continue');
    }
    const configuredModel = this.getConfiguredModel();
    if (configuredModel) {
      args.push('-m', configuredModel);
    }

    // Subcommand
    args.push('run');

    // run-specific options (must come after 'run')
    args.push(
      '--format', 'json',
      '--dir', this.config.workingDirectory,
      '--dangerously-skip-permissions',
    );

    // Message positional argument
    args.push(prompt);

    return args;
  }

  private getConfiguredModel(): string | null {
    const model = process.env.OPENCODE_MODEL;
    if (model && model !== 'configured default') return model;

    if (this.model && this.model !== 'configured default') return this.model;

    return null;
  }

  private spawnProcess(args: string[]): Promise<AgentResult> {
    return new Promise<AgentResult>((resolve) => {
      this.resolved = false;
      this.process = spawn(this.command, args, {
        cwd: this.config.workingDirectory,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let errorOutput = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          this.handleJsonLine(line);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      this.process.on('error', (err) => {
        this.process = null;
        if (!this.resolved) {
          this.resolved = true;
          const msg = `OpenCode process error: ${err.message}`;
          this.emit('error', msg);
          resolve({ status: 'failed', error: msg });
        }
      });

      this.process.on('close', (code) => {
        this.process = null;
        if (!this.resolved) {
          this.resolved = true;
          if (code !== 0) {
            const msg = errorOutput
              ? `OpenCode exited with code ${code}: ${errorOutput.trim()}`
              : `OpenCode exited with code ${code}`;
            this.emit('error', msg);
            resolve({ status: 'failed', error: msg });
          } else {
            this.emit('complete', 'OpenCode completed the task.');
            resolve({ status: 'complete' });
          }
        }
      });
    });
  }

  private handleJsonLine(line: string): void {
    try {
      const event = JSON.parse(line);
      const sessionId: string | undefined = event.sessionID;
      const timestamp = event.timestamp || Date.now();
      const contextId = this.config.contextId;

      if (sessionId) {
        this.lastSessionId = sessionId;
      }

      switch (event.type) {
        case 'text': {
          const text = event.part?.text || event.text || '';
          if (text) {
            this.emitEvent({ id: uuid(), contextId, type: 'output', content: text, timestamp });
          }
          break;
        }

        case 'reasoning': {
          const text = event.part?.text || event.text || '';
          if (text) {
            this.emitEvent({ id: uuid(), contextId, type: 'thinking', content: text, timestamp });
          }
          break;
        }

        case 'step_start':
          this.emitEvent({
            id: uuid(), contextId, type: 'thinking',
            content: 'Starting a new step...', timestamp,
          });
          break;

        case 'tool': {
          const part = event.part || {};
          const toolName: string = part.tool || '';
          const state = part.state || {};
          if (state.status === 'running') {
            this.emitEvent({
              id: uuid(), contextId, type: 'command',
              content: `${toolName}: ${JSON.stringify(state.input || {})}`,
              timestamp,
              metadata: { command: toolName },
            });
          } else if (state.status === 'completed') {
            this.emitEvent({
              id: uuid(), contextId, type: 'command_output',
              content: state.output || '',
              timestamp,
            });
          } else if (state.status === 'error') {
            this.emitEvent({
              id: uuid(), contextId, type: 'error',
              content: state.error || `Tool "${toolName}" failed`,
              timestamp,
            });
          }
          break;
        }

        case 'patch': {
          const files: string[] = event.part?.files || [];
          for (const file of files) {
            this.emitEvent({
              id: uuid(), contextId, type: 'file_write',
              content: file, timestamp,
              metadata: { file },
            });
          }
          break;
        }

        case 'error': {
          const errData = event.error?.data;
          const errMsg = errData?.message || event.error?.name || 'Unknown OpenCode error';
          this.emitEvent({ id: uuid(), contextId, type: 'error', content: errMsg, timestamp });
          break;
        }

        default:
          break;
      }
    } catch {
      // skip malformed JSON lines
    }
  }

  private emit(type: string, content: string): void {
    this.config.onEvent({
      id: uuid(),
      contextId: this.config.contextId,
      type: type as AgentEvent['type'],
      content,
      timestamp: Date.now(),
    });
  }

  private emitEvent(event: AgentEvent): void {
    this.config.onEvent(event);
  }
}
