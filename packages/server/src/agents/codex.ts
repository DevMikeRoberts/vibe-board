import { v4 as uuid } from 'uuid';
import { Codex } from '@openai/codex-sdk';
import type { AgentProvider, AgentSession, AgentSessionConfig } from './base.js';
import type { AgentType } from '../types.js';

export class CodexProvider implements AgentProvider {
  readonly name: AgentType = 'codex';
  readonly displayName = 'OpenAI Codex';
  readonly model: string;

  private codex: Codex | null = null;

  constructor() {
    this.model = process.env.CODEX_MODEL || 'gpt-5.2-codex';
  }

  async start(): Promise<void> {
    this.codex = new Codex();
    console.log(`[codex-provider] SDK initialized (model: ${this.model})`);
  }

  async stop(): Promise<void> {
    this.codex = null;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    if (!this.codex) {
      throw new Error('Codex client not initialized — call start() first');
    }

    const thread = this.codex.startThread({
      workingDirectory: config.workingDirectory,
    });

    let abortController: AbortController | null = null;

    const agentSession: AgentSession = {
      get sessionId() {
        return thread.id;
      },

      async execute(prompt: string): Promise<void> {
        abortController = new AbortController();

        const input = [{ type: 'text' as const, text: `${config.systemPrompt}\n\n${prompt}` }];
        const { events } = await thread.runStreamed(input);

        for await (const event of events) {
          if (abortController?.signal.aborted) break;

          switch (event.type) {
            case 'item.started':
              if (event.item?.type) {
                config.onEvent({
                  id: uuid(), taskId: config.taskId, type: 'command',
                  content: `Started: ${getToolDisplayName(event.item)}`,
                  timestamp: Date.now(),
                  metadata: { command: event.item.type },
                });
              }
              break;

            case 'item.completed':
              if (event.item) {
                switch (event.item.type) {
                  case 'agent_message':
                    config.onEvent({
                      id: uuid(), taskId: config.taskId, type: 'output',
                      content: event.item.text + '\n',
                      timestamp: Date.now(),
                    });
                    break;
                  case 'reasoning':
                    config.onEvent({
                      id: uuid(), taskId: config.taskId, type: 'thinking',
                      content: event.item.text,
                      timestamp: Date.now(),
                    });
                    break;
                  case 'command_execution':
                    config.onEvent({
                      id: uuid(), taskId: config.taskId, type: 'command',
                      content: `$ ${event.item.command}`,
                      timestamp: Date.now(),
                      metadata: { command: event.item.command },
                    });
                    config.onEvent({
                      id: uuid(), taskId: config.taskId, type: 'output',
                      content: event.item.aggregated_output,
                      timestamp: Date.now(),
                    });
                    break;
                  case 'file_change': {
                    const files = event.item.changes.map((c: { kind: string; path: string }) => `${c.kind}: ${c.path}`).join(', ');
                    config.onEvent({
                      id: uuid(), taskId: config.taskId, type: 'output',
                      content: `Files changed: ${files}`,
                      timestamp: Date.now(),
                    });
                    break;
                  }
                }
              }
              break;

            case 'turn.completed':
              config.onEvent({
                id: uuid(), taskId: config.taskId, type: 'complete',
                content: 'Codex completed the task.',
                timestamp: Date.now(),
              });
              break;

            case 'turn.failed':
              config.onEvent({
                id: uuid(), taskId: config.taskId, type: 'error',
                content: event.error?.message || 'Codex turn failed',
                timestamp: Date.now(),
              });
              break;

            case 'error':
              config.onEvent({
                id: uuid(), taskId: config.taskId, type: 'error',
                content: event.message || 'Unknown Codex error',
                timestamp: Date.now(),
              });
              break;
          }
        }
      },

      async abort(): Promise<void> {
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
      },

      async destroy(): Promise<void> {
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
      },
    };

    return agentSession;
  }
}

function getToolDisplayName(item: { type: string; command?: string; tool?: string }): string {
  switch (item.type) {
    case 'command_execution':
      return `Running: ${item.command?.split(' ')[0] || 'command'}`;
    case 'file_change':
      return 'Editing files';
    case 'reasoning':
      return 'Thinking...';
    default:
      return item.type;
  }
}
