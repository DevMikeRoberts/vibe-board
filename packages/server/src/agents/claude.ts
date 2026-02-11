import { v4 as uuid } from 'uuid';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentProvider, AgentSession, AgentSessionConfig } from './base.js';
import type { AgentType } from '../types.js';

export class ClaudeProvider implements AgentProvider {
  readonly name: AgentType = 'claude';
  readonly displayName = 'Claude Code';
  readonly model: string;

  constructor() {
    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
  }

  async start(): Promise<void> {
    // Claude SDK is stateless — no persistent client to start
    console.log(`[claude-provider] ready (model: ${this.model})`);
  }

  async stop(): Promise<void> {
    // Nothing to clean up
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    let sessionId: string | null = null;
    let aborted = false;

    const agentSession: AgentSession = {
      get sessionId() {
        return sessionId;
      },

      async execute(prompt: string): Promise<void> {
        const messageGenerator = createMessageGenerator(prompt);

        const response = query({
          prompt: messageGenerator,
          options: {
            model: config.workingDirectory ? undefined : undefined, // model selection handled by SDK
            cwd: config.workingDirectory,
            permissionMode: 'acceptEdits',
            systemPrompt: config.systemPrompt,
            ...(sessionId ? { resume: sessionId } : {}),
          },
        });

        for await (const message of response) {
          if (aborted) break;

          switch (message.type) {
            case 'system':
              if ('subtype' in message && message.subtype === 'init') {
                sessionId = message.session_id;
                console.log(`[claude-provider] session initialized: ${sessionId}`);
              }
              break;

            case 'assistant':
              if ('message' in message && message.message && 'content' in message.message) {
                const content = message.message.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text' && block.text) {
                      config.onEvent({
                        id: uuid(), taskId: config.taskId, type: 'output',
                        content: block.text, timestamp: Date.now(),
                      });
                    }
                  }
                }
              }
              break;

            case 'stream_event':
              if (message.event?.type === 'content_block_delta') {
                const delta = message.event.delta;
                if (delta && 'text' in delta) {
                  config.onEvent({
                    id: uuid(), taskId: config.taskId, type: 'output',
                    content: delta.text, timestamp: Date.now(),
                  });
                }
              }
              break;

            case 'tool_progress':
              config.onEvent({
                id: uuid(), taskId: config.taskId, type: 'command',
                content: `Tool: ${message.tool_name}`,
                timestamp: Date.now(),
                metadata: { command: message.tool_name },
              });
              break;

            case 'result':
              config.onEvent({
                id: uuid(), taskId: config.taskId, type: 'complete',
                content: 'Claude Code completed the task.',
                timestamp: Date.now(),
              });
              break;
          }
        }
      },

      async abort(): Promise<void> {
        aborted = true;
      },

      async destroy(): Promise<void> {
        // SDK handles cleanup automatically
      },
    };

    return agentSession;
  }
}

type SDKUserMessage = {
  type: 'user';
  message: { role: 'user'; content: Array<{ type: 'text'; text: string }> };
  parent_tool_use_id: string | null;
  session_id: string;
};

async function* createMessageGenerator(prompt: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: prompt }],
    },
    parent_tool_use_id: null,
    session_id: '',
  };
}
