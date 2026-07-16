import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Task, TaskGroup, AgentEvent, AgentType } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { AgentProvider, AgentSession, AgentInfo, AgentAttachment } from '@codewithdan/agent-sdk-core';
import type { AgentEvent as CoreAgentEvent } from '@codewithdan/agent-sdk-core';
import { CopilotProvider, ClaudeProvider, CodexProvider, HermesProvider, OpenClawProvider } from '@codewithdan/agent-sdk-core';
import { OpenCodeRunProvider } from './opencode-run-provider.js';
import { broadcast } from '../websocket.js';
import { UPLOADS_DIR } from '../routes/attachments.js';
import type { AttachmentStore } from '../repositories/attachment-types.js';
import { errorMessage } from '../utils.js';
import { detectAvailableAgents } from './agent-detection.js';
import { resolveAgentSelection, getConfiguredFallbackAgent } from './agent-fallback.js';
import { buildRepoScanPromptSection } from './repo-scan.js';
import { ContainerRunner } from './container-runner.js';

// Max agent execution time, in ms. Default 0 = no timeout: agents run until they
// finish or are explicitly stopped. Set AGENT_TIMEOUT_MS to a positive value to
// re-enable a hard cap (also used as the per-task container timeout).
const AGENT_TIMEOUT_MS = (() => {
  const parsed = parseInt(process.env.AGENT_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

function loadAttachmentAsBase64(filePath: string, displayName: string, mimeType: string): AgentAttachment | null {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[agent-manager] attachment file not found: ${filePath}`);
      return null;
    }
    const fileBuffer = fs.readFileSync(filePath);
    const data = fileBuffer.toString('base64');
    console.log(`[agent-manager] loaded attachment: ${displayName} (${mimeType}, ${fileBuffer.length} bytes, base64 length: ${data.length})`);
    return { type: 'base64_image', data, displayName, mediaType: mimeType };
  } catch (err) {
    console.error(`[agent-manager] failed to load attachment ${filePath}:`, err);
    return null;
  }
}

interface ManagedSession {
  session?: AgentSession;
  timeoutId?: ReturnType<typeof setTimeout>;
  startTime: number;
  agentType: AgentType;
}

/**
 * Fired once per natural agent completion (success or failure) so an external
 * scheduler can react — e.g. retry a token-limited task at its reset time, or
 * pick up the next backlog task. NOT fired for user-initiated stops.
 */
export interface TaskSettledInfo {
  taskId: string;
  status: 'complete' | 'failed';
  error?: string;
  agentType?: AgentType;
  /** Group id when the task is a group child (schedulers should ignore those). */
  groupId?: string;
}

export type TaskSettledHandler = (info: TaskSettledInfo) => void;

// Event log per task (capped to prevent unbounded growth)
const MAX_EVENTS_PER_TASK = 2000;
const MAX_EVENT_LOG_TASKS = 200;

// Deleted-task guard TTL
const DELETED_TASK_TTL_MS = 60_000;

const STREAM_BUFFER_FLUSH_MS = 40;
const STOPPED_TASK_TTL_MS = 30_000;

// Upper bound on accumulated assistant prose kept for summary extraction.
// We only need the tail (the final <task-summary> block), so cap memory use.
const MAX_SUMMARY_BUFFER = 64_000;

/**
 * Extract the agent-authored task summary from accumulated assistant prose.
 * Returns the trimmed contents of the LAST `<task-summary>…</task-summary>`
 * block, or null when no usable block is present.
 */
function extractTaskSummary(buffer: string): string | null {
  if (!buffer) return null;
  const closed = [...buffer.matchAll(/<task-summary>([\s\S]*?)<\/task-summary>/g)];
  if (closed.length > 0) {
    const body = closed[closed.length - 1][1].trim();
    return body.length > 0 ? body : null;
  }
  // Tolerate a missing closing tag: take everything after the last opening tag.
  const openIdx = buffer.lastIndexOf('<task-summary>');
  if (openIdx >= 0) {
    const body = buffer.slice(openIdx + '<task-summary>'.length).replace(/<\/task-summary>/g, '').trim();
    return body.length > 0 ? body : null;
  }
  return null;
}

function getErrorStderr(err: unknown): string {
  if (err instanceof Error && 'stderr' in err) {
    const stderr = (err as Error & { stderr?: Buffer | string }).stderr;
    return stderr?.toString() ?? '';
  }
  return '';
}

interface GroupQueue {
  groupId: string;
  maxConcurrency: number;
  pendingTaskIds: string[];
  runningTaskIds: Set<string>;
  completedTaskIds: Set<string>;
  failedTaskIds: Set<string>;
  tasks: Map<string, Task>;
  makeStatusCallback: (task: Task) => (status: Task['agentStatus']) => void | Promise<void>;
  onChildComplete: (taskId: string) => void | Promise<void>;
}

export class AgentManager {
  private providers = new Map<AgentType, AgentProvider>();
  private sessions = new Map<string, ManagedSession>();
  private deletedTasks = new Set<string>();
  /** Tasks stopped by user — prevents duplicate agent_complete from terminateOnce */
  private stoppedTasks = new Set<string>();
  private eventLogs = new Map<string, AgentEvent[]>();
  private eventRepo: TaskRepository | null = null;
  private attachmentStore: AttachmentStore | null = null;
  private availableAgents: AgentInfo[] = [];
  /** Pending coalesced output/thinking broadcast per task */
  private streamBuffer = new Map<string, { event: AgentEvent; timer: ReturnType<typeof setTimeout> }>();
  private groupQueues = new Map<string, GroupQueue>();
  /** Per-repo mutex to serialize git operations (merge, checkout) */
  private repoLocks = new Map<string, Promise<void>>();

  /** Containerized execution backend; null unless container mode is configured. */
  private containerRunner: ContainerRunner | null = null;

  /** Optional listener notified when a (non-group, non-stopped) task settles. */
  private taskSettledHandler: TaskSettledHandler | null = null;

  /** Register a listener for natural task completions (see {@link TaskSettledInfo}). */
  setTaskSettledHandler(handler: TaskSettledHandler | null): void {
    this.taskSettledHandler = handler;
  }

  /** Call once at startup to enable event persistence. */
  initEventPersistence(repo: TaskRepository): void {
    this.eventRepo = repo;
  }

  initAttachmentStore(store: AttachmentStore): void {
    this.attachmentStore = store;
  }

  /** Detect available agents, register providers, start the ones that are available. */
  async initialize(): Promise<void> {
    // Register all providers
    this.providers.set('copilot', new CopilotProvider());
    this.providers.set('claude', new ClaudeProvider());
    this.providers.set('codex', new CodexProvider());
    this.providers.set('opencode', new OpenCodeRunProvider());
    this.providers.set('hermes', new HermesProvider());
    this.providers.set('openclaw', new OpenClawProvider());

    // Detect which agents are actually available on this system
    this.availableAgents = await detectAvailableAgents();
    const available = this.availableAgents.filter(a => a.available);

    console.log(
      `[agent-manager] detected agents: ${this.availableAgents.map(a => `${a.displayName}=${a.available ? 'yes' : 'no'}`).join(', ')}`
    );

    // In test/CI environments there are no real agent credentials, and some
    // provider SDKs spawn a background session on start() that rejects (e.g.
    // Copilot without GitHub auth) as a detached unhandled rejection — which
    // would crash the server. When startup is disabled we skip booting real SDK
    // clients. Because no provider is started, no agent can actually run, so we
    // also report every detected agent as unavailable. This keeps the agents
    // listed in the UI (as "Unavailable") while ensuring real-execution E2E
    // specs skip instead of attempting sessions that would hang or fail — a CLI
    // shim on PATH (e.g. node_modules/.bin/copilot) otherwise makes detection
    // report an agent that cannot be used here as "available".
    const skipAgentStartup =
      process.env.AGENTBOARD_DISABLE_AGENT_STARTUP === '1' ||
      process.env.AGENTBOARD_DISABLE_AGENT_STARTUP === 'true';
    if (skipAgentStartup) {
      console.log('[agent-manager] AGENTBOARD_DISABLE_AGENT_STARTUP set — skipping provider start()');
      this.availableAgents = this.availableAgents.map(a => ({
        ...a,
        available: false,
        reason: 'Agent startup disabled (test environment)',
      }));
      return;
    }

    // Start available providers
    for (const info of available) {
      const provider = this.providers.get(info.name);
      if (provider) {
        try {
          await provider.start();
        } catch (err: unknown) {
          console.error(`[agent-manager] failed to start ${info.displayName}: ${errorMessage(err)}`);
          // Mark as unavailable
          const agentInfo = this.availableAgents.find(a => a.name === info.name);
          if (agentInfo) {
            agentInfo.available = false;
            agentInfo.reason = `Failed to start: ${errorMessage(err)}`;
          }
        }
      }
    }

    this.initContainerRunner();
  }

  getAvailableAgents(): AgentInfo[] {
    return [...this.availableAgents];
  }

  /** Enable containerized task execution when AGENTBOARD_CONTAINER_MODE is set
   *  and its prerequisites (ANTHROPIC_API_KEY, data host path, Docker) are present. */
  private initContainerRunner(): void {
    const enabled = ['1', 'true', 'yes'].includes((process.env.AGENTBOARD_CONTAINER_MODE || '').toLowerCase());
    if (!enabled) return;

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const dataHostPath = process.env.AGENTBOARD_DATA_HOST;
    const missing: string[] = [];
    if (!anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
    // Must be ABSOLUTE: it becomes the `docker run -v <src>:/repo` source on the
    // host daemon, which rejects a relative path (or mounts the wrong dir).
    if (!dataHostPath) missing.push('AGENTBOARD_DATA_HOST');
    else if (!path.isAbsolute(dataHostPath)) missing.push(`an ABSOLUTE AGENTBOARD_DATA_HOST (got "${dataHostPath}")`);
    if (!this.isDockerAvailable()) missing.push('a working Docker daemon');
    if (missing.length > 0) {
      console.warn(`[agent-manager] AGENTBOARD_CONTAINER_MODE is set but missing ${missing.join(', ')} — falling back to local execution`);
      return;
    }

    const image = process.env.AGENT_RUNNER_IMAGE || 'agentboard-agent-runner:latest';
    this.containerRunner = new ContainerRunner({
      image,
      dataDir: process.env.AGENTBOARD_DATA_DIR || '/data',
      dataHostPath: dataHostPath!,
      anthropicApiKey: anthropicApiKey!,
      model: process.env.CLAUDE_MODEL,
      timeoutMs: AGENT_TIMEOUT_MS,
    });
    console.log(`[agent-manager] containerized execution ENABLED (image: ${image})`);
  }

  private isDockerAvailable(): boolean {
    try {
      execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /** Whether a task should run in a container instead of via a local provider. */
  private shouldUseContainer(task: Task): boolean {
    if (!this.containerRunner) return false;
    if (task.groupId) return false;                       // group children stay on the local path for now
    if (!task.repoPath || !task.branchName) return false; // need a branch/workspace to operate on
    if (!this.hasRemote(task)) return false;              // need a pushable origin to open the PR
    return true;
  }

  // ─── Event Management (moved from copilot.ts) ─────────────────────

  private emitEvent(taskId: string, event: AgentEvent): void {
    if (this.deletedTasks.has(taskId)) return;
    // Drop empty content events — nothing to show
    if (!event.content?.trim() && event.type !== 'complete' && event.type !== 'error') return;

    let log = this.eventLogs.get(taskId) || [];
    log.push(event);
    if (log.length > MAX_EVENTS_PER_TASK) {
      log = log.slice(-MAX_EVENTS_PER_TASK);
    }
    // LRU touch
    this.eventLogs.delete(taskId);
    this.eventLogs.set(taskId, log);
    if (this.eventLogs.size > MAX_EVENT_LOG_TASKS) {
      const oldest = this.eventLogs.keys().next().value;
      if (oldest) this.eventLogs.delete(oldest);
    }
    // Write-through to database
    if (this.eventRepo) {
      this.eventRepo.insertEvent(event).catch((err: unknown) => {
        console.error(`[agent-manager] failed to persist event: ${errorMessage(err)}`);
      });
    }
    const STREAMABLE = new Set(['output', 'thinking']);

    const flushBuffer = (taskId: string) => {
      const buf = this.streamBuffer.get(taskId);
      if (buf) {
        clearTimeout(buf.timer);
        broadcast({ type: 'agent_event', payload: buf.event });
        this.streamBuffer.delete(taskId);
      }
    };

    if (STREAMABLE.has(event.type)) {
      const existing = this.streamBuffer.get(event.taskId);
      if (existing && existing.event.type === event.type) {
        // Same type — merge content and reset timer
        clearTimeout(existing.timer);
        existing.event.content += event.content;
        existing.timer = setTimeout(() => flushBuffer(event.taskId), STREAM_BUFFER_FLUSH_MS);
      } else {
        // Different type or no buffer — flush existing, start new buffer
        if (existing) flushBuffer(event.taskId);
        const timer = setTimeout(() => flushBuffer(event.taskId), STREAM_BUFFER_FLUSH_MS);
        this.streamBuffer.set(event.taskId, { event: { ...event }, timer });
      }
    } else {
      // Non-streamable: flush pending buffer first, then broadcast immediately
      flushBuffer(event.taskId);
      broadcast({ type: 'agent_event', payload: event });
    }
  }

  async getEvents(taskId: string): Promise<AgentEvent[]> {
    // Prefer DB (complete, ordered) over in-memory (capped, may be partial)
    if (this.eventRepo) {
      const dbEvents = await this.eventRepo.getEventsByTaskId(taskId);
      if (dbEvents.length > 0) return dbEvents;
    }
    // Fall back to in-memory (task still running, not yet persisted)
    const memEvents = this.eventLogs.get(taskId);
    if (memEvents && memEvents.length > 0) {
      this.eventLogs.delete(taskId);
      this.eventLogs.set(taskId, memEvents);
      return [...memEvents];
    }
    return [];
  }

  clearEvents(taskId: string): void {
    this.deletedTasks.add(taskId);
    setTimeout(() => this.deletedTasks.delete(taskId), DELETED_TASK_TTL_MS);
    this.resetEvents(taskId);
  }

  /** Clear stored events for a task without suppressing future events (used on re-run) */
  resetEvents(taskId: string): void {
    this.eventLogs.delete(taskId);
    if (this.eventRepo) {
      this.eventRepo.deleteEventsByTaskId(taskId).catch((err: unknown) => {
        console.error(`[agent-manager] failed to delete persisted events: ${errorMessage(err)}`);
      });
    }
  }

  // ─── Branch Setup (replaces git worktrees) ─────────────────────────

  /**
   * Set up a fresh branch for the task by:
   *  1. Fetching the latest from origin (if a remote exists)
   *  2. Checking out the base branch and pulling latest
   *  3. Creating and checking out a new task-specific branch
   *
   * This avoids merge conflicts in PRs by basing the work on the most recent
   * state of the base branch rather than on a stale worktree snapshot.
   */
  private setupBranch(task: Task): void {
    if (!task.repoPath) return;
    if (!task.branchName) task.branchName = this.generateBranchName(task);

    const repoPath = task.repoPath;
    const baseBranch = task.baseBranch || 'main';

    // Stash any uncommitted changes so they don't interfere
    try {
      execFileSync('git', ['stash', 'push', '--include-untracked', '-m', `agentboard-stash-${task.id}`], { cwd: repoPath, stdio: 'pipe' });
    } catch { /* nothing to stash */ }

    // Fetch the latest from origin
    try {
      execFileSync('git', ['fetch', 'origin', baseBranch], { cwd: repoPath, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch { /* no remote — proceed with local base branch */ }

    // Checkout base branch
    execFileSync('git', ['checkout', baseBranch], { cwd: repoPath, stdio: 'pipe' });

    // Pull latest changes
    try {
      execFileSync('git', ['pull', 'origin', baseBranch], { cwd: repoPath, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch { /* no remote */ }

    // Pick a non-colliding branch name (important for re-runs)
    const branchName = this.uniqueBranchName(repoPath, task.branchName);
    task.branchName = branchName;

    // Create and checkout the task branch
    execFileSync('git', ['checkout', '-b', branchName], { cwd: repoPath, stdio: 'pipe' });
    console.log(`[branch] created ${branchName} from latest ${baseBranch}`);
  }

  /** Generate a readable branch name for a task that lacks one. */
  private generateBranchName(task: Task): string {
    const slug = (task.title || 'task')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task';
    return `task/${slug}-${task.id.slice(0, 8)}`;
  }

  /** True when `branch` already exists as a local branch in `repoPath`. */
  private branchExists(repoPath: string, branch: string): boolean {
    try {
      execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
        cwd: repoPath, stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Return `desired`, or the first `desired-N` (N≥2) that isn't already a branch. */
  private uniqueBranchName(repoPath: string, desired: string): string {
    if (!this.branchExists(repoPath, desired)) return desired;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${desired}-${n}`;
      if (!this.branchExists(repoPath, candidate)) return candidate;
    }
    return `${desired}-${Date.now()}`;
  }

  /**
   * Commit the agent's uncommitted work to its branch so there is something to
   * open a PR from or merge. Agents are instructed to make edits but not to
   * commit (and the board treats a dirty working tree as a normal end state),
   * so without this the branch has no new commits and `gh pr create` fails with
   * "No commits between …". Best-effort and idempotent: no-ops on a clean tree
   * (e.g. the agent already committed) and never blocks completion.
   */
  private commitAgentWork(task: Task): void {
    if (!task.repoPath) return;
    const cwd = task.repoPath;
    try {
      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd, stdio: 'pipe',
      }).toString().trim();
      if (!status) return; // nothing to commit — agent already committed or made no changes

      execFileSync('git', ['add', '-A'], { cwd, stdio: 'pipe' });
      const subject = task.title.replace(/\s+/g, ' ').trim().slice(0, 72) || 'AI Agent Board task';
      execFileSync(
        'git',
        ['commit', '--no-verify', '-m', subject, '-m', `Automated commit from AI Agent Board task ${task.id}`],
        { cwd, stdio: 'pipe' },
      );
      console.log(`[commit] committed agent work on ${task.branchName}`);
      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'output',
        content: `Committed agent changes to ${task.branchName}.`,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      const msg = getErrorStderr(err) || errorMessage(err);
      console.error(`[commit] failed for task ${task.id}:`, msg);
      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'error',
        content: `Could not commit agent changes (PR/merge may be unavailable): ${msg.trim()}`,
        timestamp: Date.now(),
      });
    }
  }

  /** True when the task's repo has an 'origin' remote (so a PR can be opened). */
  hasRemote(task: Task): boolean {
    if (!task.repoPath) return false;
    const cwd = this.gitCwd(task);
    try {
      const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, stdio: 'pipe' }).toString().trim();
      return !!remoteUrl;
    } catch {
      return false;
    }
  }

  /** Directory to run git/gh from — always the repo root. */
  private gitCwd(task: Task): string {
    return task.repoPath!;
  }

  createPR(task: Task): { url: string } {
    if (!task.repoPath || !task.branchName) {
      throw new Error('Task has no repo path or branch name configured');
    }
    const baseBranch = task.baseBranch || 'main';
    const cwd = this.gitCwd(task);

    // Check that a remote named 'origin' exists
    if (!this.hasRemote(task)) {
      throw new Error(
        'No git remote "origin" configured. Push your repo to GitHub first:\n' +
        `  cd ${task.repoPath}\n` +
        '  gh repo create <name> --source=. --push'
      );
    }

    try {
      execFileSync('git', ['push', '-u', 'origin', task.branchName], { cwd, stdio: 'pipe' });

      // Idempotent: reuse an existing open PR for this branch instead of failing.
      try {
        const existing = execFileSync(
          'gh', ['pr', 'view', task.branchName, '--json', 'url', '--jq', '.url'],
          { cwd, stdio: 'pipe' },
        ).toString().trim();
        if (existing) {
          console.log(`[pr] reusing existing PR: ${existing}`);
          return { url: existing };
        }
      } catch { /* no PR yet — create one below */ }

      const prTitle = task.title.replace(/[<>]/g, '').slice(0, 200);
      const result = execFileSync(
        'gh',
        ['pr', 'create', '--base', baseBranch, '--head', task.branchName,
         '--title', prTitle, '--body', `Automated PR from Kanban task ${task.id}`, '--'],
        { cwd, stdio: 'pipe' },
      );
      const url = result.toString().trim();
      console.log(`[pr] created: ${url}`);
      return { url };
    } catch (err: unknown) {
      const stderr = getErrorStderr(err);
      const msg = stderr || errorMessage(err);
      console.error(`[pr] creation failed:`, msg);
      throw new Error(`PR creation failed: ${msg.trim()}`);
    }
  }

  private async withRepoLock<T>(repoPath: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.repoLocks.get(repoPath) ?? Promise.resolve();
    let resolve: () => void;
    const lock = new Promise<void>((r) => { resolve = r; });
    this.repoLocks.set(repoPath, lock);
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
      if (this.repoLocks.get(repoPath) === lock) this.repoLocks.delete(repoPath);
    }
  }

  async mergeLocal(task: Task): Promise<{ merged: true; baseBranch: string }> {
    if (!task.repoPath || !task.branchName) {
      throw new Error('Task has no repo path or branch name configured');
    }
    const repoPath = task.repoPath;
    const branchName = task.branchName;
    const baseBranch = task.baseBranch || 'main';

    return this.withRepoLock(repoPath, () => {
      try {
        execFileSync('git', ['checkout', baseBranch], { cwd: repoPath, stdio: 'pipe' });
        execFileSync('git', ['merge', branchName, '--no-edit'], { cwd: repoPath, stdio: 'pipe' });
        console.log(`[merge] merged ${branchName} into ${baseBranch}`);
        return { merged: true as const, baseBranch };
      } catch (err: unknown) {
        try { execFileSync('git', ['merge', '--abort'], { cwd: repoPath, stdio: 'pipe' }); } catch { /* already clean */ }
        const stderr = getErrorStderr(err);
        const msg = stderr || errorMessage(err);
        console.error(`[merge] failed:`, msg);
        throw new Error(`Merge failed (conflicts?). Branch ${branchName} was not merged:\n${msg.trim()}`);
      }
    });
  }

  /**
   * Query the merge state of the task's open PR via the GitHub CLI. Returns the
   * raw PR state (`OPEN` | `MERGED` | `CLOSED`) plus a convenience `merged` flag,
   * or null when the state can't be determined (no `gh`, no PR for the branch,
   * network/auth error). Best-effort: never throws. Used by {@link PrWatcher} to
   * follow an auto-opened PR to its merge.
   */
  getPullRequestState(task: Task): { state: string; merged: boolean } | null {
    if (!task.repoPath) return null;
    // The PR URL uniquely identifies the PR even after the local branch is gone;
    // fall back to the branch name when no URL was recorded.
    const ref = task.prUrl || task.branchName;
    if (!ref) return null;
    const cwd = this.gitCwd(task);
    try {
      const out = execFileSync(
        'gh', ['pr', 'view', ref, '--json', 'state,mergedAt'],
        { cwd, stdio: 'pipe' },
      ).toString().trim();
      if (!out) return null;
      const parsed = JSON.parse(out) as { state?: string; mergedAt?: string | null };
      const state = parsed.state ?? 'UNKNOWN';
      const merged = state === 'MERGED' || !!parsed.mergedAt;
      return { state, merged };
    } catch {
      return null;
    }
  }

  /**
   * Get detailed PR state including mergeable status and CI check results. Used
   * by the auto-PR pipeline and {@link PrWatcher} to detect conflicts, failing
   * CI, or a closed-without-merge PR as early as possible. Best-effort — never
   * throws. Returns null when the state can't be determined.
   */
  getPRDetails(task: Task): {
    url: string;
    state: string;
    mergeable: string;
    merged: boolean;
    ciPassed: boolean | null;
    ciPending: boolean;
    checkConclusions: string[];
  } | null {
    if (!task.repoPath) return null;
    const ref = task.prUrl || task.branchName;
    if (!ref) return null;
    const cwd = this.gitCwd(task);
    try {
      const out = execFileSync(
        'gh', ['pr', 'view', ref, '--json', 'state,mergeable,mergedAt,url,statusCheckRollup'],
        { cwd, stdio: 'pipe' },
      ).toString().trim();
      if (!out) return null;
      const parsed = JSON.parse(out) as {
        state?: string;
        mergeable?: string;
        mergedAt?: string | null;
        url?: string;
        statusCheckRollup?: Array<{ conclusion?: string | null; status?: string }>;
      };

      const state = parsed.state ?? 'UNKNOWN';
      const mergeable = parsed.mergeable ?? 'UNKNOWN';
      const url = parsed.url ?? String(ref);
      const merged = state === 'MERGED' || !!parsed.mergedAt;

      const checkConclusions: string[] = [];
      let ciPassed: boolean | null = null;
      let ciPending = false;

      if (parsed.statusCheckRollup && parsed.statusCheckRollup.length > 0) {
        for (const check of parsed.statusCheckRollup) {
          const c = ((check.conclusion ?? check.status) ?? '').toUpperCase();
          if (c) checkConclusions.push(c);
        }
        const FAIL_STATES = ['FAILURE', 'ERROR', 'CANCELLED', 'ACTION_REQUIRED', 'TIMED_OUT'];
        const PENDING_STATES = ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'EXPECTED'];
        const hasFailure = checkConclusions.some((s) => FAIL_STATES.includes(s));
        const hasPending = checkConclusions.some((s) => PENDING_STATES.includes(s));
        ciPending = hasPending && !hasFailure;
        if (hasFailure) ciPassed = false;
        else if (!hasPending) ciPassed = true; // all completed successfully
      }

      return { url, state, mergeable, merged, ciPassed, ciPending, checkConclusions };
    } catch {
      return null;
    }
  }

  /**
   * Attempt to rebase the task's branch on the latest upstream base branch to
   * resolve merge conflicts, then force-push the result to update the PR. Uses
   * the per-repo mutex so it never races concurrent git operations. Throws on
   * failure (caller is responsible for emitting a user-facing error event).
   */
  async rebaseOnBase(task: Task): Promise<void> {
    if (!task.repoPath || !task.branchName) {
      throw new Error('Task has no repo path or branch name configured');
    }
    const cwd = this.gitCwd(task);
    const baseBranch = task.baseBranch || 'main';

    return this.withRepoLock(task.repoPath, async () => {
      try {
        execFileSync('git', ['fetch', 'origin', baseBranch], { cwd, stdio: 'pipe', timeout: 30_000 });
        execFileSync('git', ['rebase', `origin/${baseBranch}`], { cwd, stdio: 'pipe' });
        execFileSync('git', ['push', '--force-with-lease', 'origin', task.branchName!], {
          cwd, stdio: 'pipe', timeout: 60_000,
        });
        console.log(`[rebase] rebased ${task.branchName} on origin/${baseBranch} and pushed`);
      } catch (err: unknown) {
        try { execFileSync('git', ['rebase', '--abort'], { cwd, stdio: 'pipe' }); } catch { /* already clean */ }
        const stderr = getErrorStderr(err);
        const msg = stderr || errorMessage(err);
        console.error(`[rebase] failed for task ${task.id}:`, msg);
        throw new Error(`Rebase failed: ${msg.trim()}`);
      }
    });
  }

  /**
   * Resolve merge conflicts on the task's branch by merging the latest base
   * branch into it and, when that produces conflicts, launching an AI agent
   * session to resolve them intelligently.
   *
   * Flow:
   *  1. Fetch `origin/{baseBranch}`
   *  2. Check out the task's feature branch
   *  3. `git merge origin/{baseBranch}` — auto-merges what it can
   *  4. If merge produces conflicts, create a provider session whose prompt
   *     lists the conflicting files and asks the agent to resolve every
   *     conflict marker while preserving the intent of both sides
   *  5. Verify all conflicts are gone after the agent finishes
   *  6. Stage the resolution, commit, and push
   *
   * Uses the per-repo mutex so it never races concurrent git operations.
   * Throws on failure (caller is responsible for emitting a user-facing
   * error event).
   */
  async resolveMergeConflicts(task: Task): Promise<void> {
    if (!task.repoPath || !task.branchName) {
      throw new Error('Task has no repo path or branch name configured');
    }
    const cwd = this.gitCwd(task);
    const baseBranch = task.baseBranch || 'main';
    const branchName: string = task.branchName;
    const repoPath: string = task.repoPath;

    return this.withRepoLock(repoPath, async () => {
      // 1. Fetch latest base branch
      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'output',
        content: `Fetching latest origin/${baseBranch} to resolve merge conflicts…`,
        timestamp: Date.now(), metadata: { phase: 'conflict-resolution' },
      });
      execFileSync('git', ['fetch', 'origin', baseBranch], { cwd, stdio: 'pipe', timeout: 30_000 });

      // 2. Check out the feature branch
      execFileSync('git', ['checkout', branchName], { cwd, stdio: 'pipe' });

      // 3. Merge base into feature branch
      try {
        execFileSync('git', ['merge', `origin/${baseBranch}`, '--no-edit'], {
          cwd, stdio: 'pipe', timeout: 30_000,
        });
        execFileSync('git', ['push', 'origin', branchName], {
          cwd, stdio: 'pipe', timeout: 60_000,
        });
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'output',
          content: `Merged origin/${baseBranch} into ${branchName} — no conflicts. Pushed update.`,
          timestamp: Date.now(), metadata: { phase: 'conflict-resolution' },
        });
        return;
      } catch {
        // Merge has conflicts — proceed with agent-based resolution
      }

      // 4. List conflicted files
      const conflictOutput = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd, stdio: 'pipe' })
        .toString().trim();
      const conflictedFiles = conflictOutput ? conflictOutput.split('\n').filter(Boolean) : [];
      if (conflictedFiles.length === 0) {
        throw new Error('Merge failed but no conflicted files detected');
      }

      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'output',
        content:
          `Merge with origin/${baseBranch} produced conflicts in ${conflictedFiles.length} file(s):\n` +
          conflictedFiles.map((f) => `  - ${f}`).join('\n') +
          '\nLaunching agent to resolve conflicts…',
        timestamp: Date.now(), metadata: { phase: 'conflict-resolution' },
      });

      // 5. Resolve which agent to use (honour fallback chain)
      let agentType = task.agentType || 'copilot';
      const selection = resolveAgentSelection({
        requested: agentType,
        agents: this.availableAgents,
        preferredFallback: getConfiguredFallbackAgent(),
      });
      if (!selection.agentType) {
        throw new Error(selection.reason || `Agent "${agentType}" is not available to resolve conflicts`);
      }
      agentType = selection.agentType;

      const provider = this.providers.get(agentType);
      if (!provider) {
        throw new Error(`No provider registered for agent type: ${agentType}`);
      }

      // 6. Build concise conflict-resolution prompts
      const safeTitle = task.title.replace(/[<>]/g, '');
      const repoScanSection = buildRepoScanPromptSection(agentType, repoPath);

      const systemPrompt = `
<context>
You are a coding agent resolving merge conflicts in the repository at ${repoPath}.

Your task is to fix ALL merge conflict markers (<<<<<<<, =======, >>>>>>>) in the
conflicted files listed below. For each conflict examine both the HEAD version (the
feature branch) and the MERGE_HEAD version (the base branch), then produce a single
correct merged result that preserves the intent of both sides.

${repoScanSection}

When you have finished fixing all conflicts, end your VERY LAST message with:
<task-summary>
## Completed
What conflicts you resolved and how.
</task-summary>
</context>
`;

      const prompt =
        `Task: ${safeTitle}\n\n` +
        'The following files have merge conflicts between the feature branch and the base branch:\n' +
        conflictedFiles.map((f) => `  - ${f}`).join('\n') +
        '\n\n' +
        'For each conflicted file, read it, examine both sides of every conflict marker, ' +
        'and edit the file to produce the correct merged result. Remove ALL conflict markers ' +
        '(<<<<<<<, =======, >>>>>>> and any accompanying git metadata lines).\n' +
        'Do NOT add or remove anything unrelated to the conflict resolution.';

      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'output',
        content: `Agent ${provider.displayName} is resolving ${conflictedFiles.length} merge conflict(s)…`,
        timestamp: Date.now(), metadata: { phase: 'conflict-resolution', agentType },
      });

      // 7. Create session and execute conflict resolution
      const session = await provider.createSession({
        contextId: `conflict-${task.id}`,
        workingDirectory: repoPath,
        repoPath,
        systemPrompt,
        onEvent: (coreEvent) => {
          const eventType = coreEvent.type === 'error' ? 'error' : 'output';
          this.emitEvent(task.id, {
            id: coreEvent.id, taskId: task.id,
            type: eventType as AgentEvent['type'],
            content: coreEvent.content,
            timestamp: coreEvent.timestamp,
            metadata: { phase: 'conflict-resolution', agentType },
          });
        },
      });

      const result = await session.execute(prompt);
      session.destroy().catch(() => {});

      if (result.status === 'failed') {
        throw new Error(`Agent conflict resolution failed: ${result.error || 'unknown error'}`);
      }

      // 8. Verify all conflicts are gone
      const remaining = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd, stdio: 'pipe' })
        .toString().trim();
      if (remaining) {
        throw new Error(
          `Agent did not resolve all conflicts. Remaining conflicted files:\n${
            remaining.split('\n').filter(Boolean).join('\n')
          }`,
        );
      }

      // 9. Stage, commit, and push the resolution
      execFileSync('git', ['add', '-A'], { cwd, stdio: 'pipe' });
      execFileSync(
        'git',
        ['commit', '--no-verify', '-m', `Resolve merge conflicts between ${branchName} and ${baseBranch}`,
          '-m', 'Automated conflict resolution from AI Agent Board.'],
        { cwd, stdio: 'pipe' },
      );
      execFileSync('git', ['push', 'origin', branchName], {
        cwd, stdio: 'pipe', timeout: 60_000,
      });

      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'output',
        content:
          `Merge conflicts resolved and pushed to ${branchName}. ` +
          'The pull request has been updated — GitHub will re-compute the merge state shortly.',
        timestamp: Date.now(), metadata: { phase: 'conflict-resolution' },
      });
    });
  }

  /**
   * Best-effort delete of the task's local branch once its PR has merged. Runs
   * from the repo (never a worktree, which would still have the branch checked
   * out) and is serialized per-repo to avoid racing concurrent git operations.
   * Never throws — a missing/already-pruned branch is fine.
   */
  async deleteBranch(task: Task): Promise<void> {
    if (!task.repoPath || !task.branchName) return;
    const repoPath = task.repoPath;
    const branchName = task.branchName;
    await this.withRepoLock(repoPath, () => {
      try {
        execFileSync('git', ['branch', '-D', branchName], { cwd: repoPath, stdio: 'pipe' });
        console.log(`[branch] deleted ${branchName}`);
      } catch (err: unknown) {
        // Branch may already be gone (e.g. worktree removal pruned it) — non-fatal.
        console.warn(`[branch] delete ${branchName} skipped:`, errorMessage(err));
      }
    });
  }

  // ─── Session Lifecycle ─────────────────────────────────────────────

  startAgent(
    task: Task,
    onStatusChange: (status: Task['agentStatus']) => void | Promise<void>,
  ): void {
    if (this.sessions.has(task.id)) return;

    let agentType = task.agentType || 'copilot';
    const sessionStartTime = Date.now();
    let terminated = false;

    // Clear any prior run's summary so a rerun never displays a stale result
    // (e.g. if this run fails before producing a new summary).
    if (task.summary != null) {
      void this.eventRepo?.update(task.id, { summary: null }).catch(() => {});
    }
    const terminateOnce = async (status: 'complete' | 'failed', errorMessage?: string) => {
      if (terminated) return;
      // If the task was stopped by the user, stopAgent already handled cleanup
      if (this.stoppedTasks.has(task.id)) { terminated = true; return; }
      terminated = true;
      const entry = this.sessions.get(task.id);
      if (entry?.timeoutId) clearTimeout(entry.timeoutId);
      // Always release the session here so every completion path (including the
      // container branch's failure paths) clears `isRunning` and allows re-runs.
      this.sessions.delete(task.id);
      const duration = Date.now() - sessionStartTime;

      // Item 5: Emit structured summary event
      if (status === 'complete') {
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'complete',
          content: 'Task completed successfully.',
          timestamp: Date.now(),
          metadata: { agentType, duration },
        });
      } else {
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'error',
          content: errorMessage || 'Task failed.',
          timestamp: Date.now(),
          metadata: { agentType, duration, error: errorMessage },
        });
      }

      // Item 2: Broadcast agent_complete WS event
      broadcast({
        type: 'agent_complete',
        payload: {
          taskId: task.id,
          status,
          agentType,
          duration,
          eventCount: (await this.getEvents(task.id)).length,
        },
      });

      onStatusChange(status);

      // Notify the scheduler (token-limit retry / backlog auto-pickup). Runs
      // after onStatusChange so DB state is (best-effort) up to date; the
      // handler re-reads from the DB and never throws into this path.
      if (this.taskSettledHandler) {
        try {
          this.taskSettledHandler({ taskId: task.id, status, error: errorMessage, agentType, groupId: task.groupId });
        } catch (err) {
          console.error(`[agent-manager] task settled handler threw for task ${task.id}:`, err);
        }
      }
    };

    // ── Containerized execution path ──────────────────────────────────
    // When container mode is configured, run the Claude agent inside an
    // ephemeral Docker container against an isolated per-task workspace, then
    // hand off to the auto-PR + review pipeline. Bypasses the local provider,
    // availability check, and /tmp worktree setup below.
    if (this.shouldUseContainer(task)) {
      const runner = this.containerRunner!;
      this.sessions.set(task.id, { startTime: sessionStartTime, agentType });
      void (async () => {
        let workspace: { containerPath: string; hostPath: string };
        try {
          workspace = runner.prepareWorkspace(task);
          task.worktreePath = workspace.containerPath;
          // The container always runs Claude — reflect that as the task's agent
          // so the review pipeline picks a DIFFERENT agent as the reviewer.
          if (task.agentType !== 'claude') {
            task.agentType = 'claude';
            try { await this.eventRepo?.update(task.id, { agentType: 'claude' }); } catch { /* non-fatal */ }
          }
          this.emitEvent(task.id, {
            id: uuid(), taskId: task.id, type: 'output',
            content: `Launching containerized Claude agent.\nWorkspace: ${workspace.containerPath}\nBranch: ${task.branchName} from ${task.baseBranch || 'main'}`,
            timestamp: Date.now(), metadata: { phase: 'container' },
          });
        } catch (err: unknown) {
          this.emitEvent(task.id, {
            id: uuid(), taskId: task.id, type: 'error',
            content: `Container workspace setup failed: ${errorMessage(err)}`,
            timestamp: Date.now(),
          });
          terminateOnce('failed', `Container workspace setup failed: ${errorMessage(err)}`);
          return;
        }

        onStatusChange('executing');
        const safeTitle = task.title.replace(/[<>]/g, '');
        const safeDescription = (task.description || '').replace(/[<>]/g, '');
        const prompt = `${safeTitle}\n\n${safeDescription}`;
        const systemPrompt =
          'You are a coding agent working in the repository mounted at /repo. Complete the task in the user prompt: read relevant files, make precise edits, and verify your changes when applicable. When finished, end your last message with a <task-summary>…</task-summary> block describing what you accomplished.';

        let summaryBuffer = '';
        const result = await runner.run(task, {
          prompt,
          systemPrompt,
          hostWorkspacePath: workspace.hostPath,
          onEvent: (type, content) => {
            if (type === 'output') {
              summaryBuffer += content + '\n';
              if (summaryBuffer.length > MAX_SUMMARY_BUFFER) summaryBuffer = summaryBuffer.slice(-MAX_SUMMARY_BUFFER);
            }
            this.emitEvent(task.id, {
              id: uuid(), taskId: task.id, type, content,
              timestamp: Date.now(), metadata: { phase: 'container', agentType: 'claude' },
            });
          },
        });

        if (this.sessions.has(task.id)) {
          this.sessions.delete(task.id);
          if (result.status === 'complete') {
            try {
              const summary = extractTaskSummary(summaryBuffer);
              await this.eventRepo?.update(task.id, { summary });
            } catch (err) {
              console.error(`[agent-manager] failed to persist summary for task ${task.id}:`, errorMessage(err));
            }
            // The container commits its own work; this catches anything left over.
            this.commitAgentWork(task);
          }
          terminateOnce(result.status, result.error);
        }
      })().catch((err: unknown) => terminateOnce('failed', errorMessage(err)));
      return;
    }

    // Resolve which agent actually picks up the task. If the requested agent is
    // unavailable (uninstalled, unauthenticated, or out of credits), fall back
    // to another available agent — preferring a free/local model (e.g. OpenCode
    // driving a local Ollama model) so the work still gets done instead of the
    // task failing outright.
    const selection = resolveAgentSelection({
      requested: agentType,
      agents: this.availableAgents,
      preferredFallback: getConfiguredFallbackAgent(),
    });
    if (!selection.agentType) {
      void terminateOnce('failed', selection.reason || `Agent "${agentType}" is not available.`);
      return;
    }
    if (selection.fellBack) {
      agentType = selection.agentType;
      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'output',
        content: selection.reason || `Selected agent unavailable — falling back to ${agentType}.`,
        timestamp: Date.now(), metadata: { phase: 'fallback', agentType },
      });
      // Persist + broadcast the swap so the board, follow-up messages, and the
      // review pipeline all use the agent that actually ran.
      if (task.agentType !== agentType) {
        task.agentType = agentType;
        void this.eventRepo?.update(task.id, { agentType }).catch(() => {});
        broadcast({ type: 'task_updated', payload: task });
      }
    }

    const provider = this.providers.get(agentType);
    if (!provider) {
      void terminateOnce('failed', `No provider registered for agent type: ${agentType}`);
      return;
    }

    // Synchronous placeholder to prevent duplicate starts during async session creation
    this.sessions.set(task.id, { startTime: sessionStartTime, agentType });

    // For repo-backed tasks, create a fresh branch based on the latest state
    // of the base branch instead of using a git worktree. This prevents stale
    // base branches that cause merge conflicts in PRs.
    if (task.repoPath) {
      const priorBranch = task.branchName;
      try {
        this.setupBranch(task);
        // setupBranch may have generated or de-collided the branch name on a
        // re-run — persist + broadcast it so PR/merge/UI use the branch that ran.
        if (task.branchName && task.branchName !== priorBranch) {
          void this.eventRepo?.update(task.id, { branchName: task.branchName }).catch(() => {});
          broadcast({ type: 'task_updated', payload: task });
        }
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'output',
          content: `Branch created: ${task.branchName}\nBase: ${task.baseBranch || 'main'} (pulled latest)`,
          timestamp: Date.now(),
        });
      } catch (err: unknown) {
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'error',
          content: `Branch setup failed: ${errorMessage(err)}`,
          timestamp: Date.now(),
        });
        terminateOnce('failed', `Branch setup failed: ${errorMessage(err)}`);
        return;
      }
    }

    // Launch the agent session asynchronously
    (async () => {
      try {
        const workingDirectory = task.repoPath || process.cwd();
        const hasGit = fs.existsSync(path.join(workingDirectory, '.git'));
        // Sanitize task content to prevent prompt injection via </context> breakout
        const safeTitle = task.title.replace(/[<>]/g, '');
        // Non-Claude agents skip repo understanding and produce off-convention
        // changes; inject a Claude-native repo-scan skill so they build context
        // first. No-ops (empty string) for Claude or when disabled via env.
        const repoScanSection = buildRepoScanPromptSection(agentType, workingDirectory);
        if (repoScanSection) {
          this.emitEvent(task.id, {
            id: uuid(), taskId: task.id, type: 'output',
            content: `Repo-scan skill enabled for ${agentType}: the agent will scan the repository for context before implementing.`,
            timestamp: Date.now(), metadata: { phase: 'repo-scan', agentType },
          });
        }
        const systemPrompt = `
<context>
You are a coding agent working on a task in the project directory: ${workingDirectory}
Task: ${safeTitle}
${!hasGit ? `\nIMPORTANT: This directory is not a git repository. Run \`git init\` first before making any changes, so all work is tracked.` : ''}
Complete the task described in the user prompt. Be thorough — read relevant files,
make precise edits, and verify your changes compile/pass tests when applicable.
${repoScanSection}

When you have finished, end your VERY LAST message with a task summary in EXACTLY this format (keep the tags on their own lines):
<task-summary>
## Completed
A clear description of what you accomplished. This section is required and must not be empty.
## Comments
Optional notes, caveats, decisions, or context. Omit the body if there is nothing to add.
## Remaining
Optional list of any work you did not complete or that should be followed up. Omit the body if everything is done.
</task-summary>
</context>
`;

        // Track file context across tool_execution_start → command_output pairs
        let lastFileEventFile: string | null = null;
        let lastFileEventType: string | null = null;

        // Accumulate assistant prose ('output' events) to extract the agent's
        // end-of-task <task-summary> marker block after completion.
        let summaryBuffer = '';

        const session = await provider.createSession({
          contextId: task.id,
          workingDirectory,
          repoPath: task.repoPath,
          systemPrompt,
          onEvent: (coreEvent: CoreAgentEvent) => {
            const metadata: Record<string, unknown> = { ...coreEvent.metadata };
            let eventType = coreEvent.type;
            let content = coreEvent.content;

            // Accumulate raw assistant prose for summary extraction, then strip
            // the literal sentinel tags so they don't render in the Events tab.
            if (coreEvent.type === 'output') {
              summaryBuffer += content;
              if (summaryBuffer.length > MAX_SUMMARY_BUFFER) {
                summaryBuffer = summaryBuffer.slice(-MAX_SUMMARY_BUFFER);
              }
              if (content.includes('task-summary')) {
                content = content.replace(/<\/?task-summary>/g, '');
              }
            }

            // Reclassify 'create' tool as file_write
            if (coreEvent.type === 'command' && metadata.command === 'create') {
              eventType = 'file_write';
            }

            // Enrich file events with metadata.file extracted from tool arguments
            if ((eventType === 'file_write' || eventType === 'file_edit' || eventType === 'file_read') && !metadata.file) {
              const colonIdx = coreEvent.content.indexOf(':');
              if (colonIdx > 0) {
                try {
                  const args = JSON.parse(coreEvent.content.slice(colonIdx + 1).trim());
                  const filePath = args.path || args.file_path || args.file || args.filename;
                  if (filePath) {
                    metadata.file = filePath;
                    lastFileEventFile = filePath;
                    lastFileEventType = eventType;
                  }
                } catch { /* not JSON args, skip */ }
              }
            }

            // Detect file writes from bash commands (cat > file, echo > file, mkdir, etc.)
            if (coreEvent.type === 'command' && metadata.command === 'bash') {
              const content = coreEvent.content;
              // Match: cat > path, cat >> path, echo ... > path, tee path
              const redirectMatch = content.match(/(?:cat|echo|printf)\s+.*?>\s*(\S+)/);
              const teeMatch = content.match(/tee\s+(\S+)/);
              const filePath = redirectMatch?.[1] || teeMatch?.[1];
              if (filePath && !filePath.startsWith('-')) {
                metadata.file = filePath.replace(/['"]/g, '');
                metadata.fileEventType = 'file_write';
              }
            }

            // Carry file metadata from preceding file_write/file_edit to its command_output
            if (coreEvent.type === 'command_output' && lastFileEventFile && lastFileEventType) {
              metadata.file = lastFileEventFile;
              metadata.fileEventType = lastFileEventType;
              lastFileEventFile = null;
              lastFileEventType = null;
            } else if (eventType !== 'file_write' && eventType !== 'file_edit' && eventType !== 'file_read') {
              lastFileEventFile = null;
              lastFileEventType = null;
            }

            this.emitEvent(task.id, {
              id: coreEvent.id,
              taskId: task.id,
              type: eventType as AgentEvent['type'],
              content,
              timestamp: coreEvent.timestamp,
              metadata,
            });
          },
        });

        this.sessions.set(task.id, { session, startTime: sessionStartTime, agentType });
        onStatusChange('executing');

        // Optional timeout guard — armed only when a positive AGENT_TIMEOUT_MS
        // is configured. Default (0) lets the agent run until it finishes or is
        // stopped.
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (AGENT_TIMEOUT_MS > 0) {
          timeoutId = setTimeout(() => {
            if (!this.sessions.has(task.id)) return;
            const timeoutMsg = `Agent timed out after ${Math.round(AGENT_TIMEOUT_MS / 60000)} minutes`;
            console.warn(`[agent-manager] task ${task.id} timed out after ${AGENT_TIMEOUT_MS}ms`);
            this.emitEvent(task.id, {
              id: uuid(), taskId: task.id, type: 'error',
              content: timeoutMsg,
              timestamp: Date.now(),
            });
            const entry = this.sessions.get(task.id);
            if (entry) {
              this.sessions.delete(task.id);
              entry.session?.abort().catch(() => {});
              entry.session?.destroy().catch(() => {});
            }
            terminateOnce('failed', timeoutMsg);
          }, AGENT_TIMEOUT_MS);

          const entry = this.sessions.get(task.id);
          if (entry) entry.timeoutId = timeoutId;
        }

        // Build prompt and execute — each provider returns a typed AgentResult
        const safeDescription = (task.description || '').replace(/[<>]/g, '');
        const prompt = `${safeTitle}\n\n${safeDescription}`;

        // Load image attachments if available
        let agentAttachments: AgentAttachment[] | undefined;
        if (this.attachmentStore) {
          const taskAttachments = await this.attachmentStore.getByTaskId(task.id);
          if (taskAttachments.length > 0) {
            const loaded: AgentAttachment[] = [];
            for (const a of taskAttachments) {
              const srcPath = path.join(UPLOADS_DIR, a.taskId, a.filename);
              const att = loadAttachmentAsBase64(srcPath, a.originalName, a.mimeType);
              if (att) loaded.push(att);
            }
            if (loaded.length > 0) agentAttachments = loaded;
          }
        }

        console.log(`[agent-manager] executing ${agentType} for task ${task.id}${agentAttachments?.length ? ` with ${agentAttachments.length} image(s)` : ''}`);
        const result = await session.execute(prompt, agentAttachments);
        console.log(`[agent-manager] ${agentType} ${result.status} for task ${task.id}${result.error ? `: ${result.error}` : ''}`);

        clearTimeout(timeoutId);

        // Primary completion path — status comes from the provider
        if (this.sessions.has(task.id)) {
          this.sessions.delete(task.id);
        // On success, persist the agent-authored summary BEFORE the status
        // transition so the task-update broadcast carries it to clients.
        // Always write (extracted value or null) so a rerun can't leave a
        // stale summary from a previous run. Never let this block completion.
        if (result.status === 'complete') {
          try {
            const summary = extractTaskSummary(summaryBuffer);
            await this.eventRepo?.update(task.id, { summary });
          } catch (err) {
            console.error(`[agent-manager] failed to persist summary for task ${task.id}:`, errorMessage(err));
          }
          // Commit the agent's work so the task branch has something to PR/merge.
          if (task.repoPath) this.commitAgentWork(task);
          terminateOnce('complete');
        } else {
          // ── Concierge: try to fix failures automatically ─────────────
          // Before giving up, launch an OpenCode subagent that diagnoses the
          // error and attempts to fix the codebase. If it succeeds, the task
          // completes normally instead of failing.
          const conciergeFixed = await this.tryConciergeFix(task, summaryBuffer, result.error);
          if (conciergeFixed) {
            if (task.repoPath) this.commitAgentWork(task);
            terminateOnce('complete');
          } else {
            terminateOnce('failed', result.error);
          }
        }
        session.destroy().catch(() => {});
      }
    } catch (err: unknown) {
      const message = errorMessage(err);
      const isCliMissing =
        message.includes('ENOENT') ||
        message.includes('not found') ||
        message.includes('spawn');

      const errorContent = isCliMissing
        ? `${provider.displayName} CLI is not installed or not found in PATH.`
        : `Failed to start ${provider.displayName} session: ${message}`;

      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'error',
        content: errorContent,
        timestamp: Date.now(),
      });

      const entry = this.sessions.get(task.id);
      if (entry) this.sessions.delete(task.id);
      terminateOnce('failed', errorContent);
    }
  })().catch((err: unknown) => {
    console.error(`[agent-manager] unhandled error for task ${task.id}:`, err);
    terminateOnce('failed');
  });
}

  /**
   * Launch an OpenCode concierge subagent to diagnose and fix a failed task.
   * Returns true if the concierge resolved the issue, false otherwise.
   * The concierge receives the task context, agent output, and error details,
   * then investigates and attempts to fix the root cause in the codebase.
   */
  private async tryConciergeFix(
    task: Task,
    summaryBuffer: string,
    error: string | undefined,
  ): Promise<boolean> {
    const provider = this.providers.get('opencode');
    if (!provider) return false;

    this.emitEvent(task.id, {
      id: uuid(), taskId: task.id, type: 'output',
      content: '🤖 Concierge activated — diagnosing and fixing issue…',
      timestamp: Date.now(),
      metadata: { phase: 'concierge' },
    });

    const workingDirectory = task.repoPath || process.cwd();
    const safeTitle = task.title.replace(/[<>]/g, '');
    const safeDescription = (task.description || '(none)').replace(/[<>]/g, '');
    let conciergeBuffer = '';

    const conciergePrompt = `A coding task failed and needs fixing.

## Task
- Title: ${safeTitle}
- Description: ${safeDescription}
- Working directory: ${workingDirectory}
- Error: ${error || 'Unknown error'}

## Agent Output (last part)
${summaryBuffer.slice(-8000)}

## Instructions
Investigate what went wrong by checking files, code, and configuration.
Identify the root cause — not just symptoms — and fix ALL issues.
Run git status to verify state changes.

When done, end with EXACTLY:
<concierge-result>fixed</concierge-result>

If you CANNOT fix it, end with:
<concierge-result>unable-to-fix</concierge-result>`;

    try {
      const conciergeSession = await provider.createSession({
        contextId: `concierge-${task.id}-${Date.now()}`,
        workingDirectory,
        repoPath: task.repoPath,
        systemPrompt: 'You are a concierge agent that diagnoses and fixes issues in coding tasks. Be thorough, fix the root cause, and verify your changes.',
        onEvent: (coreEvent: CoreAgentEvent) => {
          conciergeBuffer += coreEvent.content + '\n';
          this.emitEvent(task.id, {
            id: coreEvent.id,
            taskId: task.id,
            type: coreEvent.type as AgentEvent['type'],
            content: coreEvent.content,
            timestamp: coreEvent.timestamp,
            metadata: { ...coreEvent.metadata, phase: 'concierge' },
          });
        },
      });

      const result = await conciergeSession.execute(conciergePrompt);
      conciergeSession.destroy().catch(() => {});

      if (result.status === 'complete' && conciergeBuffer.includes('<concierge-result>fixed</concierge-result>')) {
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'output',
          content: '✅ Concierge resolved the issue.',
          timestamp: Date.now(),
          metadata: { phase: 'concierge' },
        });
        return true;
      }
    } catch (err) {
      console.error(`[concierge] error for task ${task.id}:`, errorMessage(err));
    }

    this.emitEvent(task.id, {
      id: uuid(), taskId: task.id, type: 'output',
      content: '❌ Concierge could not resolve the issue.',
      timestamp: Date.now(),
      metadata: { phase: 'concierge' },
    });
    return false;
  }

  async sendMessage(taskId: string, message: string, attachmentIds?: string[]): Promise<boolean> {
    const entry = this.sessions.get(taskId);
    if (!entry?.session) return false;

    this.emitEvent(taskId, {
      id: uuid(), taskId, type: 'command',
      content: `Follow-up message sent: ${message}${attachmentIds?.length ? ` (with ${attachmentIds.length} image(s))` : ''}`,
      timestamp: Date.now(),
    });

    // Load attachments if IDs provided
    let agentAttachments: AgentAttachment[] | undefined;
    if (attachmentIds?.length && this.attachmentStore) {
      const loaded: AgentAttachment[] = [];
      for (const id of attachmentIds) {
        const a = await this.attachmentStore.getById(id);
        if (!a) continue;
        const srcPath = path.join(UPLOADS_DIR, a.taskId, a.filename);
        const att = loadAttachmentAsBase64(srcPath, a.originalName, a.mimeType);
        if (att) loaded.push(att);
      }
      if (loaded.length > 0) agentAttachments = loaded;
    }

    try {
      await entry.session.send(message, agentAttachments);
    } catch (err: unknown) {
      const providerName = this.providers.get(entry.agentType)?.displayName || entry.agentType;
      throw new Error(`${providerName} failed to process follow-up: ${errorMessage(err)}`);
    }
    return true;
  }

  async stopAgent(taskId: string): Promise<boolean> {
    const entry = this.sessions.get(taskId);
    if (!entry) return false;

    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    const duration = Date.now() - entry.startTime;
    const { agentType } = entry;
    this.sessions.delete(taskId);
    // Mark as stopped so terminateOnce (from the catch block) won't double-broadcast
    this.stoppedTasks.add(taskId);
    setTimeout(() => this.stoppedTasks.delete(taskId), STOPPED_TASK_TTL_MS);

    (async () => {
      try { await entry.session?.abort(); } catch { /* ignore */ }
      try { await entry.session?.destroy(); } catch { /* ignore */ }
    })();
    // Stop a running per-task container, if this task was executing in one.
    this.containerRunner?.kill(taskId);

    this.emitEvent(taskId, {
      id: uuid(), taskId, type: 'error',
      content: 'Agent stopped by user.',
      timestamp: Date.now(),
      metadata: { agentType, duration, error: 'Agent stopped by user.' },
    });

    // Broadcast agent_complete so WS listeners know the agent finished
    broadcast({
      type: 'agent_complete',
      payload: {
        taskId,
        status: 'failed',
        agentType,
        duration,
        eventCount: (await this.getEvents(taskId)).length,
      },
    });

    // Clean up stale group queue entry if this task belongs to a running group
    for (const [groupId, q] of this.groupQueues) {
      if (q.runningTaskIds.delete(taskId)) {
        q.failedTaskIds.add(taskId);
        Promise.resolve(q.onChildComplete(taskId)).catch((err: unknown) =>
          console.error('[group] onChildComplete failed:', err),
        );
        if (q.pendingTaskIds.length === 0 && q.runningTaskIds.size === 0) {
          this.groupQueues.delete(groupId);
        } else {
          queueMicrotask(() => this.drainGroupQueue(groupId));
        }
        break;
      }
    }

    return true;
  }

  isRunning(taskId: string): boolean {
    return this.sessions.has(taskId);
  }

  shutdownAll(): void {
    const entries = [...this.sessions.entries()];
    this.sessions.clear();

    for (const [, entry] of entries) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      (async () => {
        try { await entry.session?.abort(); } catch { /* ignore */ }
        try { await entry.session?.destroy(); } catch { /* ignore */ }
      })();
    }

    for (const provider of this.providers.values()) {
      provider.stop().catch(() => {});
    }
  }

  // ─── Group Queue ──────────────────────────────────────────────────

  isGroupRunning(groupId: string): boolean {
    return this.groupQueues.has(groupId);
  }

  startGroup(
    group: TaskGroup,
    children: Task[],
    makeStatusCb: (task: Task) => (status: Task['agentStatus']) => void | Promise<void>,
    onChildComplete: (taskId: string) => void | Promise<void>,
  ): void {
    if (this.groupQueues.has(group.id)) return;

    const queue: GroupQueue = {
      groupId: group.id,
      maxConcurrency: group.maxConcurrency,
      pendingTaskIds: children.map((c) => c.id),
      runningTaskIds: new Set(),
      completedTaskIds: new Set(),
      failedTaskIds: new Set(),
      tasks: new Map(children.map((c) => [c.id, c])),
      makeStatusCallback: makeStatusCb,
      onChildComplete,
    };

    this.groupQueues.set(group.id, queue);
    this.drainGroupQueue(group.id);
  }

  private drainGroupQueue(groupId: string): void {
    const queue = this.groupQueues.get(groupId);
    if (!queue) return;

    // Use queueMicrotask to avoid reentrancy issues when startAgent
    // synchronously calls onStatusChange('failed') for unavailable agents
    const startNext = () => {
      const q = this.groupQueues.get(groupId);
      if (!q) return;
      if (q.runningTaskIds.size >= q.maxConcurrency || q.pendingTaskIds.length === 0) return;

      const taskId = q.pendingTaskIds.shift()!;
      const task = q.tasks.get(taskId);
      if (!task) { startNext(); return; }

      q.runningTaskIds.add(taskId);

      const originalStatusCb = q.makeStatusCallback(task);
      const wrappedStatusCb = async (status: Task['agentStatus']) => {
        // Await status persistence so DB is consistent before completion check
        await originalStatusCb(status);

        if (status === 'complete' || status === 'failed') {
          q.runningTaskIds.delete(taskId);
          if (status === 'complete') {
            q.completedTaskIds.add(taskId);
          } else {
            q.failedTaskIds.add(taskId);
          }

          // Notify completion (catch to prevent unhandled rejection crash)
          Promise.resolve(q.onChildComplete(taskId)).catch((err: unknown) =>
            console.error('[group] onChildComplete failed:', err),
          );

          // Clean up queue when fully drained
          if (q.pendingTaskIds.length === 0 && q.runningTaskIds.size === 0) {
            this.groupQueues.delete(groupId);
          } else {
            queueMicrotask(() => this.drainGroupQueue(groupId));
          }
        }
      };

      this.startAgent(task, wrappedStatusCb);

      // Start more if we haven't hit concurrency limit
      startNext();
    };

    startNext();
  }

  async stopGroup(groupId: string): Promise<void> {
    const queue = this.groupQueues.get(groupId);
    if (!queue) return;

    // Clear pending
    queue.pendingTaskIds.length = 0;

    // Stop running children
    const running = [...queue.runningTaskIds];
    for (const taskId of running) {
      await this.stopAgent(taskId);
    }

    this.groupQueues.delete(groupId);
  }
}
