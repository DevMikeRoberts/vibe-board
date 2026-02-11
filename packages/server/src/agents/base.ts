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
  /** Original repo path — used for worktree path rewriting to enforce sandboxing. */
  repoPath?: string;
  systemPrompt: string;
  onEvent: (event: AgentEvent) => void;
  /** Called when the agent session becomes idle (backup completion signal). */
  onIdle?: () => void;
}

export interface AgentSession {
  execute(prompt: string): Promise<void>;
  abort(): Promise<void>;
  destroy(): Promise<void>;
  readonly sessionId: string | null;
}
