import type { AgentType, AgentEvent } from '../types.js';

export interface AgentProvider {
  readonly name: AgentType;
  readonly displayName: string;
  readonly model: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  createSession(config: AgentSessionConfig): Promise<AgentSession>;
}

export interface AgentSessionConfig {
  taskId: string;
  workingDirectory: string;
  systemPrompt: string;
  onEvent: (event: AgentEvent) => void;
}

export interface AgentSession {
  execute(prompt: string): Promise<void>;
  abort(): Promise<void>;
  destroy(): Promise<void>;
  readonly sessionId: string | null;
}
