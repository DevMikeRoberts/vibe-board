import { v4 as uuid } from 'uuid';
import {
  CopilotClient,
  type CopilotSession,
  type SessionEvent,
} from '@github/copilot-sdk';
import type { AgentProvider, AgentSession, AgentSessionConfig } from './base.js';
import type { AgentType } from '../types.js';

// Configurable deny-list for high-risk tool kinds (comma-separated env var).
// Example: COPILOT_DENIED_TOOLS="dangerous_tool,rm_rf"
const DENIED_TOOLS = new Set(
  (process.env.COPILOT_DENIED_TOOLS || '').split(',').map(s => s.trim()).filter(Boolean)
);

export class CopilotProvider implements AgentProvider {
  readonly name: AgentType = 'copilot';
  readonly displayName = 'GitHub Copilot';
  readonly model: string;

  private client: CopilotClient | null = null;

  constructor() {
    this.model = process.env.COPILOT_MODEL || 'claude-sonnet-4-20250514';
  }

  async start(): Promise<void> {
    this.client = new CopilotClient({
      logLevel: 'info',
      autoRestart: true,
    });
    await this.client.start();
    console.log(`[copilot-provider] SDK client started (model: ${this.model})`);
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    if (!this.client) {
      throw new Error('Copilot client not initialized — call start() first');
    }

    const repoPath = config.repoPath;
    const worktreePath = repoPath && config.workingDirectory !== repoPath
      ? config.workingDirectory
      : undefined;

    const session: CopilotSession = await this.client.createSession({
      model: this.model,
      streaming: true,
      workingDirectory: config.workingDirectory,
      systemMessage: {
        mode: 'append',
        content: config.systemPrompt,
      },
      onPermissionRequest: (req) => {
        // Deny tools on the deny-list
        if (DENIED_TOOLS.size > 0 && DENIED_TOOLS.has(req.kind)) {
          console.warn(`[copilot-provider] DENIED tool: ${req.kind} for task ${config.taskId}`);
          return { kind: 'denied-by-rules' };
        }
        console.log(
          `[copilot-provider] approved tool: ${req.kind} for task ${config.taskId}`,
          JSON.stringify(req),
        );
        return { kind: 'approved' };
      },
      // Worktree path sandboxing: rewrite any file paths that reference
      // the original repo to point into the worktree instead.
      ...(worktreePath && repoPath
        ? {
            hooks: {
              onPreToolUse: (input: { toolName: string; toolArgs: unknown; cwd: string }) => {
                if (!input.toolArgs || typeof input.toolArgs !== 'object') return {};

                const args = input.toolArgs as Record<string, unknown>;
                let changed = false;

                function rewriteValue(val: unknown): unknown {
                  if (typeof val === 'string' && val.includes(repoPath!)) {
                    changed = true;
                    return val.replaceAll(repoPath!, worktreePath!);
                  }
                  if (Array.isArray(val)) return val.map(rewriteValue);
                  if (val && typeof val === 'object') {
                    const obj: Record<string, unknown> = {};
                    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                      obj[k] = rewriteValue(v);
                    }
                    return obj;
                  }
                  return val;
                }

                const modifiedArgs: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(args)) {
                  modifiedArgs[key] = rewriteValue(value);
                }

                if (changed) {
                  console.log(`[copilot-provider] rewrote paths for task ${config.taskId}: ${repoPath} → ${worktreePath}`);
                  return { modifiedArgs };
                }
                return {};
              },
            },
          }
        : {}),
    });

    let unsubscribe: (() => void) | null = null;

    const agentSession: AgentSession = {
      get sessionId() {
        return session.sessionId ?? null;
      },

      async execute(prompt: string): Promise<void> {
        // Subscribe to session events and map to AgentEvents
        unsubscribe = session.on((event: SessionEvent) => {
          mapSessionEvent(config.taskId, event, config.onEvent);

          // Backup completion: if session becomes idle, signal the manager
          if (event.type === 'session.idle' && config.onIdle) {
            console.log(`[copilot-provider] session.idle for task ${config.taskId} (backup completion)`);
            config.onIdle();
          }
        });

        await session.sendAndWait({ prompt });
      },

      async abort(): Promise<void> {
        try { await session.abort(); } catch { /* ignore */ }
      },

      async destroy(): Promise<void> {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        try { await session.destroy(); } catch { /* ignore */ }
      },
    };

    return agentSession;
  }
}

function mapSessionEvent(
  taskId: string,
  event: SessionEvent,
  onEvent: AgentSessionConfig['onEvent'],
): void {
  switch (event.type) {
    case 'assistant.turn_start':
      onEvent({ id: uuid(), taskId, type: 'thinking', content: 'Starting a new turn...', timestamp: Date.now() });
      break;

    case 'assistant.intent':
      onEvent({ id: uuid(), taskId, type: 'thinking', content: event.data.intent, timestamp: Date.now() });
      break;

    case 'assistant.reasoning_delta':
      onEvent({ id: uuid(), taskId, type: 'thinking', content: event.data.deltaContent, timestamp: Date.now() });
      break;

    case 'assistant.message':
      onEvent({ id: uuid(), taskId, type: 'complete', content: event.data.content, timestamp: Date.now() });
      break;

    case 'assistant.message_delta':
      onEvent({ id: uuid(), taskId, type: 'output', content: event.data.deltaContent, timestamp: Date.now() });
      break;

    case 'tool.execution_start':
      onEvent({
        id: uuid(), taskId, type: 'command',
        content: `${event.data.toolName}: ${JSON.stringify(event.data.arguments ?? '')}`,
        timestamp: Date.now(),
        metadata: { command: event.data.toolName },
      });
      break;

    case 'tool.execution_complete':
      onEvent({
        id: uuid(), taskId, type: 'output',
        content: event.data.result?.content ?? event.data.error?.message ?? '',
        timestamp: Date.now(),
      });
      break;

    case 'tool.execution_partial_result':
      onEvent({ id: uuid(), taskId, type: 'output', content: event.data.partialOutput, timestamp: Date.now() });
      break;

    case 'session.error':
      onEvent({ id: uuid(), taskId, type: 'error', content: event.data.message, timestamp: Date.now() });
      break;

    default:
      break;
  }
}
