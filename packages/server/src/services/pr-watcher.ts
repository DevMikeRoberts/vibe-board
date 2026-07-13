import { v4 as uuid } from 'uuid';
import type { Task } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { ProjectRepository } from '../repositories/project-types.js';
import type { AgentManager } from './agent-manager.js';
import { broadcast } from '../websocket.js';
import { broadcastTaskUpdate } from '../routes/helpers.js';
import { errorMessage } from '../utils.js';

/** How often to poll open PRs for tasks waiting in the review column. */
const PR_WATCH_TICK_MS = 60_000;

/**
 * Watches the pull requests opened for completed tasks and drives them to "done"
 * once merged.
 *
 * Every tick it scans tasks sitting in the **review** column with a recorded
 * `prUrl`, asks the GitHub CLI (via {@link AgentManager.getPRDetails}) whether
 * each PR has merged, and when it has:
 *
 *  1. removes the task's worktree (if it somehow survived PR creation),
 *  2. deletes the local branch,
 *  3. moves the task to the **done** column, and
 *  4. emits an informational event on the task timeline.
 *
 * In addition to the happy-path merge detection, each tick also checks for:
 *
 * - **Conflicts** (`mergeable === 'CONFLICTING'`): emits a warning and attempts
 *   an automatic rebase to resolve them. Conflict-fix progress is tracked per
 *   task so the rebase is only attempted once until the PR's mergeable state
 *   changes again.
 *
 * - **CI failures**: emits a warning event when checks fail, and a recovery
 *   notice when they later pass. Both are debounced so only a single event is
 *   emitted per state transition.
 *
 * - **Closed-without-merge PRs**: emits an error event (once) so the developer
 *   knows to reopen or create a new PR.
 *
 * Polling (rather than a GitHub webhook) keeps this self-contained for a board
 * that already shells out to `gh`, and makes it restart-safe: state lives in the
 * task rows, so a fresh process simply resumes watching on its next tick.
 */
export class PrWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private inTick = false;

  /**
   * Tasks for which a conflict warning has already been emitted in the current
   * conflict window. Cleared when the conflict resolves so we'll warn again if
   * conflicts reappear after a rebase.
   */
  private readonly conflictWarned = new Set<string>();

  /**
   * Tasks for which a conflict-resolution rebase is currently in progress.
   * Guards against launching concurrent rebase attempts on the same task.
   */
  private readonly conflictFixInProgress = new Set<string>();

  /**
   * Tasks for which a CI-failure warning has been emitted. Cleared when CI
   * later passes so a recovery notice can be emitted.
   */
  private readonly ciFailureWarned = new Set<string>();

  /**
   * Tasks for which a closed-without-merge warning has been emitted. We only
   * warn once to avoid repeating the event on every subsequent tick.
   */
  private readonly closedWarned = new Set<string>();

  constructor(
    private readonly repo: TaskRepository,
    private readonly agentManager: AgentManager,
    private readonly projectRepo: ProjectRepository,
  ) {}

  /** Begin polling. Runs an immediate pass, then every {@link PR_WATCH_TICK_MS}. */
  start(): void {
    this.runTick();
    this.timer = setInterval(() => this.runTick(), PR_WATCH_TICK_MS);
    this.timer.unref?.();
  }

  /** Stop polling (used on shutdown). */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Trigger an out-of-band scan now (e.g. right after a PR was auto-opened). */
  poke(): void {
    this.runTick();
  }

  private runTick(): void {
    void this.tick().catch((err) =>
      console.error('[pr-watcher] tick failed:', errorMessage(err)),
    );
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.inTick) return;
    this.inTick = true;
    try {
      const projects = await this.projectRepo.getAllWithCounts();
      for (const project of projects) {
        if (this.stopped) return;
        const tasks = await this.repo.getAll(false, project.id);
        for (const task of tasks) {
          if (this.stopped) return;
          if (task.columnId !== 'review' || !task.prUrl || !task.repoPath) continue;
          await this.checkTask(task);
        }
      }
    } finally {
      this.inTick = false;
    }
  }

  /**
   * Check a single in-review task. Uses `getPRDetails` (which fetches state,
   * mergeable, and CI checks in one `gh pr view` call) and handles all
   * meaningful PR state transitions. Falls back to the lighter
   * `getPullRequestState` when `gh` returns data that `getPRDetails` can't
   * parse (e.g. very old `gh` versions without `statusCheckRollup`).
   */
  private async checkTask(task: Task): Promise<void> {
    const details = this.agentManager.getPRDetails(task);

    if (!details) {
      // Lightweight fallback when the richer call fails (no gh, auth error, etc.)
      const state = this.agentManager.getPullRequestState(task);
      if (state?.merged) await this.completeMergedTask(task);
      return;
    }

    // ── Merged ──────────────────────────────────────────────────────────
    if (details.merged) {
      // Clear all per-task tracking state on a successful merge
      this.conflictWarned.delete(task.id);
      this.conflictFixInProgress.delete(task.id);
      this.ciFailureWarned.delete(task.id);
      this.closedWarned.delete(task.id);
      await this.completeMergedTask(task);
      return;
    }

    // ── Closed without merging ────────────────────────────────────────
    if (details.state === 'CLOSED') {
      if (!this.closedWarned.has(task.id)) {
        this.closedWarned.add(task.id);
        this.emitNotice(
          task.id,
          `Pull request was closed without merging.\n` +
          `Branch "${task.branchName}" has not been merged into the base branch. ` +
          'Use the Create PR button to open a new pull request, or use Merge to main to merge locally.',
          task.agentType,
          'error',
        );
        console.log(`[pr-watcher] task ${task.id} PR closed without merge`);
      }
      return;
    }

    // ── PR is still OPEN — check for conflicts and CI issues ─────────
    this.checkConflicts(task, details.mergeable);
    this.checkCi(task, details.ciPassed, details.checkConclusions);
  }

  /** Emit a conflict warning and kick off an auto-rebase when appropriate. */
  private checkConflicts(task: Task, mergeable: string): void {
    if (mergeable === 'CONFLICTING') {
      if (!this.conflictWarned.has(task.id)) {
        this.conflictWarned.add(task.id);
        if (!this.conflictFixInProgress.has(task.id)) {
          this.conflictFixInProgress.add(task.id);
          this.emitNotice(
            task.id,
            `⚠️  Pull request has merge conflicts with the base branch. ` +
            `Attempting to rebase ${task.branchName} on ${task.baseBranch || 'main'} automatically…`,
            task.agentType,
          );
          void this.attemptConflictFix(task);
        }
      }
    } else if (mergeable !== 'UNKNOWN') {
      // Conflicts resolved (or were never present) — reset state so we'll warn
      // again if new conflicts appear after the next push.
      if (this.conflictWarned.has(task.id)) {
        this.conflictWarned.delete(task.id);
        this.conflictFixInProgress.delete(task.id);
        this.emitNotice(
          task.id,
          `Merge conflicts resolved — pull request is now mergeable.`,
          task.agentType,
        );
      }
    }
    // 'UNKNOWN' means GitHub hasn't finished computing the merge state yet — skip.
  }

  /** Emit CI failure / recovery notices with debouncing per state transition. */
  private checkCi(task: Task, ciPassed: boolean | null, checkConclusions: string[]): void {
    if (ciPassed === false) {
      if (!this.ciFailureWarned.has(task.id)) {
        this.ciFailureWarned.add(task.id);
        const FAIL_STATES = ['FAILURE', 'ERROR', 'CANCELLED', 'ACTION_REQUIRED', 'TIMED_OUT'];
        const failCount = checkConclusions.filter((s) => FAIL_STATES.includes(s)).length;
        this.emitNotice(
          task.id,
          `⚠️  ${failCount > 0 ? `${failCount} CI check(s) are` : 'CI checks are'} failing on this pull request.\n` +
          `Fix the issues and push to ${task.branchName} to re-trigger CI before merging.`,
          task.agentType,
          'error',
        );
        console.log(`[pr-watcher] task ${task.id} CI failing (${failCount} check(s))`);
      }
    } else if (ciPassed === true && this.ciFailureWarned.has(task.id)) {
      // CI recovered — let the developer know
      this.ciFailureWarned.delete(task.id);
      this.emitNotice(
        task.id,
        `CI checks are now passing. Pull request is ready to review and merge.`,
        task.agentType,
      );
      console.log(`[pr-watcher] task ${task.id} CI recovered`);
    }
  }

  /**
   * Rebase the task's branch on its base branch to auto-fix merge conflicts,
   * then force-push so the PR is updated. When the rebase fails due to
   * conflicts, falls through to agent-based resolution — the AI agent reads
   * the conflicting files and fixes every conflict marker.
   *
   * Emits success or error events for each stage.
   */
  private async attemptConflictFix(task: Task): Promise<void> {
    try {
      // First try: clean rebase (linear history)
      await this.agentManager.rebaseOnBase(task);
      // Conflict fix in progress flag will be cleared on the next tick once we
      // confirm the mergeable state has changed, but we remove it here too so
      // a second tick doesn't try to rebase again while GitHub re-computes state.
      this.conflictFixInProgress.delete(task.id);
      this.emitNotice(
        task.id,
        `Automatically rebased ${task.branchName} on ${task.baseBranch || 'main'} to resolve merge conflicts. ` +
        'The pull request has been updated — GitHub will re-compute the merge state shortly.',
        task.agentType,
      );
      console.log(`[pr-watcher] task ${task.id} auto-rebase succeeded`);
      return;
    } catch (rebaseErr: unknown) {
      console.log(`[pr-watcher] task ${task.id} rebase failed, trying agent-based resolution: ${errorMessage(rebaseErr)}`);
    }

    // Fallback: agent-based merge conflict resolution
    try {
      await this.agentManager.resolveMergeConflicts(task);
      this.conflictFixInProgress.delete(task.id);
      this.emitNotice(
        task.id,
        `Agent resolved merge conflicts between ${task.branchName} and ${task.baseBranch || 'main'}. ` +
        'The pull request has been updated — GitHub will re-compute the merge state shortly.',
        task.agentType,
      );
      console.log(`[pr-watcher] task ${task.id} agent conflict resolution succeeded`);
    } catch (agentErr: unknown) {
      this.conflictFixInProgress.delete(task.id);
      this.emitNotice(
        task.id,
        'Could not automatically resolve merge conflicts.\n' +
        'Manual conflict resolution is required. Resolve the conflicts, push to ' +
        `${task.branchName}, and the PR will be updated.`,
        task.agentType,
        'error',
      );
      console.log(`[pr-watcher] task ${task.id} both rebase and agent resolution failed`);
    }
  }

  /** Move a merged-PR task to done and clean up its local branch. */
  private async completeMergedTask(task: Task): Promise<void> {
    try { await this.agentManager.deleteBranch(task); } catch { /* best effort */ }

    const updated = await this.repo.update(task.id, {
      columnId: 'done',
      completedAt: Date.now(),
    });
    if (updated) broadcastTaskUpdate(updated);

    this.emitNotice(
      task.id,
      `Pull request merged — task moved to Done.` +
      (task.branchName ? ` Cleaned up branch ${task.branchName}.` : ''),
      task.agentType,
    );
    console.log(`[pr-watcher] task ${task.id} PR merged → done`);
  }

  /** Persist + broadcast a notice event on a task's timeline. */
  private emitNotice(
    taskId: string,
    content: string,
    agentType?: Task['agentType'],
    type: 'output' | 'error' = 'output',
  ): void {
    const event = {
      id: uuid(),
      taskId,
      type,
      content,
      timestamp: Date.now(),
      metadata: { phase: 'pr-watcher', ...(agentType ? { agentType } : {}) },
    };
    void this.repo.insertEvent(event).catch((err: unknown) =>
      console.error('[pr-watcher] failed to persist notice:', errorMessage(err)),
    );
    broadcast({ type: 'agent_event', payload: event });
  }
}
