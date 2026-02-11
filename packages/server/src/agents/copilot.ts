import { v4 as uuid } from 'uuid';
import {
  CopilotClient,
  type CopilotSession,
  type SessionEvent,
} from '@github/copilot-sdk';
import type { AgentProvider, AgentSession, AgentSessionConfig } from './base.js';
import type { AgentType } from '../types.js';

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

    const session: CopilotSession = await this.client.createSession({
      model: this.model,
      streaming: true,
      workingDirectory: config.workingDirectory,
      systemMessage: {
        mode: 'append',
        content: config.systemPrompt,
      },
      onPermissionRequest: (req) => {
        console.log(`[copilot-provider] approved tool: ${req.kind} for task ${config.taskId}`);
        return { kind: 'approved' };
      },
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
