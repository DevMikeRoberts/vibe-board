export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type ColumnId = 'backlog' | 'in-progress' | 'review' | 'done';
export type AgentStatus = 'idle' | 'planning' | 'executing' | 'complete' | 'failed';
export type AgentType = 'copilot' | 'claude' | 'codex' | 'opencode' | 'hermes' | 'openclaw';

/**
 * Legacy review-pipeline state. The automatic PR + adversarial-review pipeline
 * has been removed — completed tasks now land in the "review" column for manual
 * PR/merge. This type and the `reviewStatus`/`reviewRound` fields are retained
 * only for backward compatibility with existing database rows.
 */
export type ReviewStatus =
  | 'opening_pr'         // creating/locating the PR for the finished branch
  | 'reviewing'          // an adversarial reviewer agent is examining the diff
  | 'changes_requested'  // reviewer rejected; task bounced back to in-progress
  | 'approved'           // reviewer approved (merge in progress)
  | 'merged'             // approved and merged into the base branch
  | 'needs_human'        // round cap hit without approval — handed back to you
  | 'error';             // the pipeline failed (see task events)

export interface AgentInfo {
  name: AgentType;
  displayName: string;
  available: boolean;
  version?: string;
  reason?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  columnId: ColumnId;
  agentStatus: AgentStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  repoPath?: string;
  branchName?: string;
  baseBranch?: string;
  useWorktree?: boolean;
  worktreePath?: string;
  agentType?: AgentType;
  archived?: boolean;
  groupId?: string;
  groupOrder?: number;
  attachments?: TaskAttachment[];
  projectId: string;
  summary?: string | null;
  /** URL of the pull request opened by the auto-PR pipeline, if any. */
  prUrl?: string;
  /** How many adversarial-review cycles this task has been through. */
  reviewRound?: number;
  /** Current state of the auto-PR + adversarial-review pipeline. */
  reviewStatus?: ReviewStatus;
  /**
   * Epoch ms at which this task is scheduled to automatically re-run after its
   * agent hit a token/usage/rate limit. Set by the token-limit retry scheduler;
   * cleared once the retry fires (or the task is run/edited/deleted manually).
   */
  retryAt?: number;
}

export interface TaskGroup {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  columnId: ColumnId;
  repoPath?: string;
  baseBranch?: string;
  maxConcurrency: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  archived?: boolean;
  projectId: string;
}

export interface ProjectTaskCounts {
  backlog: number;
  'in-progress': number;
  review: number;
  done: number;
  total: number;
}

export interface Project {
  id: string;
  name: string;
  repoPath?: string;
  /** Source GitHub/git URL the project's local repo was cloned from, if any. */
  repoUrl?: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  taskCounts?: ProjectTaskCounts;
  /** Default task properties for this project. Each is overridable per task. */
  defaultAgentType?: AgentType;
  defaultPriority?: Priority;
  defaultBaseBranch?: string;
  defaultUseWorktree?: boolean;
}

export interface CreateProjectRequest {
  name?: string;
  repoPath?: string;
  /** When provided, the server clones this git URL into the configured clone root and uses it as repoPath. */
  repoUrl?: string;
  defaultAgentType?: AgentType;
  defaultPriority?: Priority;
  defaultBaseBranch?: string;
  defaultUseWorktree?: boolean;
}

export interface UpdateProjectRequest {
  name?: string;
  repoPath?: string | null;
  repoUrl?: string | null;
  defaultAgentType?: AgentType | null;
  defaultPriority?: Priority | null;
  defaultBaseBranch?: string | null;
  defaultUseWorktree?: boolean | null;
}

/** Server-side Agent Board configuration (persisted to the config file). */
export interface ProjectConfig {
  /** Absolute path under which repos cloned from a URL are placed. */
  cloneRoot: string;
  /**
   * Auto-pickup ("stagger"): when enabled, the board automatically starts the
   * next idle backlog task — one at a time per project — as soon as the project
   * has no task currently running. Disabled by default.
   */
  autoPickupEnabled?: boolean;
  /**
   * Token-limit retry: when enabled, a task whose agent fails because it hit a
   * token/usage/rate limit is automatically re-run around the time the limit is
   * reported to reset (best-effort parse of the error). Disabled by default.
   */
  tokenLimitRetryEnabled?: boolean;
  /**
   * Minutes to wait before retrying a token-limited task when no reset time can
   * be parsed from the error. Defaults to 60.
   */
  tokenLimitFallbackMinutes?: number;
}

export interface ProjectPathValidation {
  repoPath: string;
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  error?: string;
  warning?: string;
}

export type AgentEventType =
  | 'thinking'
  | 'tool_call'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'command'
  | 'command_output'
  | 'output'
  | 'test_result'
  | 'error'
  | 'complete';

export interface AgentEvent {
  id: string;
  taskId: string;
  type: AgentEventType;
  content: string;
  timestamp: number;
  metadata?: {
    file?: string;
    fileEventType?: string;
    language?: string;
    command?: string;
    diff?: string;
    agentType?: AgentType;
    duration?: number;
    error?: string;
    /** Set on events produced by the auto-PR/review pipeline ('pipeline' | 'review'). */
    phase?: string;
    /** Agent type that produced an adversarial-review event. */
    reviewer?: AgentType;
  };
}

export interface Column {
  id: ColumnId;
  title: string;
  color: string;
  icon: string;
}

export interface AgentCompletePayload {
  taskId: string;
  status: 'complete' | 'failed';
  agentType?: AgentType;
  duration: number;
  eventCount: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: Priority;
  agentType: AgentType;
  repoPath?: string;
  baseBranch?: string;
  useWorktree?: boolean;
  createdAt: number;
}

export interface AgentFollowUpPayload {
  taskId: string;
  message: string;
  attachmentIds?: string[];
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

export type WSMessage =
  | { type: 'agent_event'; payload: AgentEvent }
  | { type: 'task_updated'; payload: Task }
  | { type: 'task_deleted'; payload: { id: string } }
  | { type: 'agent_complete'; payload: AgentCompletePayload }
  | { type: 'agent_follow_up'; payload: AgentFollowUpPayload }
  | { type: 'group_updated'; payload: TaskGroup }
  | { type: 'project_updated'; payload: Project }
  | { type: 'project_deleted'; payload: { id: string } };
