import { v4 as uuid } from 'uuid';
import type { Task, AgentType, Priority, ProjectConfig } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { ProjectRepository } from '../repositories/project-types.js';
import type { AgentManager, TaskSettledInfo } from './agent-manager.js';
import { broadcast } from '../websocket.js';
import { broadcastTaskUpdate, makeStatusCallback } from '../routes/helpers.js';
import { detectTokenLimit } from './token-limit.js';
import { errorMessage } from '../utils.js';

/** Buffer added after a parsed reset time so the limit has definitely lifted. */
const RETRY_BUFFER_MS = 30_000;
/** Never retry sooner than this (avoids a tight loop on flaky limits). */
const RETRY_MIN_DELAY_MS = 10_000;
/** Cap how far out a retry can be scheduled (a parsed time could be bogus). */
const RETRY_MAX_DELAY_MS = 12 * 60 * 60_000;
/** How often the safety tick re-evaluates auto-pickup for every project. */
const PICKUP_TICK_MS = 30_000;
/** How many trailing events to scan (with the error) for limit signals. */
const FAILURE_EVENT_SCAN = 80;

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Order backlog candidates: highest priority first, then oldest first. */
function pickupOrder(a: Task, b: Task): number {
  const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
  return pr !== 0 ? pr : a.createdAt - b.createdAt;
}

function formatDelay(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return `${Math.round(ms / 1000)}s`;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Owns two pieces of board automation:
 *
 *  1. **Token-limit retry** — when an agent fails because it hit a token/usage/
 *     rate limit, parse the reset time and re-run the task around then instead
 *     of leaving it failed.
 *  2. **Auto-pickup (staggering)** — when enabled, start the next idle backlog
 *     task automatically, one at a time per project, as soon as the project has
 *     nothing running (or a pending retry).
 *
 * Both are gated by persisted settings (see {@link ProjectConfig}) read live via
 * `getSettings`, so toggling them takes effect immediately.
 */
export class TaskScheduler {
  /** taskId → pending retry timer. Presence also marks a project as "busy". */
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** taskIds the scheduler is in the middle of launching (pre-session). */
  private launching = new Set<string>();
  /** projectIds with an in-flight pickup pass (re-entrancy guard). */
  private pickupInFlight = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly repo: TaskRepository,
    private readonly agentManager: AgentManager,
    private readonly projectRepo: ProjectRepository,
    private readonly getSettings: () => ProjectConfig,
  ) {}

  /** Wire the manager's settled hook, re-arm persisted retries, start the tick. */
  async start(): Promise<void> {
    this.agentManager.setTaskSettledHandler((info) => this.handleSettled(info));
    await this.rearmPersistedRetries();
    this.kickAllProjects();
    this.tickTimer = setInterval(() => this.kickAllProjects(), PICKUP_TICK_MS);
    this.tickTimer.unref?.();
  }

  /** Stop the tick and clear all pending retry timers (used on shutdown). */
  stop(): void {
    this.stopped = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  /** Re-evaluate auto-pickup for every project (e.g. after a settings change). */
  onSettingsChanged(): void {
    this.kickAllProjects();
  }

  /** A task was created/moved into a project — try to pick it up. */
  notifyTaskChanged(projectId: string | undefined): void {
    void this.tryPickup(projectId ?? 'default');
  }

  /**
   * Cancel a pending token-limit retry timer for a task (manual run/stop/delete
   * supersede a scheduled retry). Does not touch the DB `retryAt` marker — the
   * caller clears that as part of its own update. Returns true if one existed.
   */
  cancelRetry(taskId: string): boolean {
    const timer = this.retryTimers.get(taskId);
    if (!timer) return false;
    clearTimeout(timer);
    this.retryTimers.delete(taskId);
    return true;
  }

  // ─── Settled handling ─────────────────────────────────────────────

  private handleSettled(info: TaskSettledInfo): void {
    void this.onSettled(info).catch((err) =>
      console.error('[scheduler] onSettled failed:', errorMessage(err)),
    );
  }

  private async onSettled(info: TaskSettledInfo): Promise<void> {
    if (this.stopped) return;
    if (info.groupId) return; // group children are driven by the group queue
    const task = await this.repo.getById(info.taskId);
    if (!task || task.groupId) return;

    const settings = this.getSettings();
    let scheduledRetry = false;

    if (info.status === 'failed' && settings.tokenLimitRetryEnabled) {
      const text = await this.collectFailureText(info.taskId, info.error);
      const limit = detectTokenLimit(text);
      if (limit.isLimit) {
        await this.scheduleRetry(task, limit.resetAt);
        scheduledRetry = true;
      }
    }

    // A pending retry keeps the project "busy" (one at a time), so only try the
    // next backlog task when we did NOT just schedule a retry for this one.
    if (!scheduledRetry) {
      await this.tryPickup(task.projectId ?? 'default');
    }
  }

  /** Combine the terminal error with the tail of the event log for detection. */
  private async collectFailureText(taskId: string, error?: string): Promise<string> {
    let text = error ?? '';
    try {
      const events = await this.agentManager.getEvents(taskId);
      const tail = events.slice(-FAILURE_EVENT_SCAN).map((e) => e.content).join('\n');
      text = `${text}\n${tail}`;
    } catch {
      /* events are best-effort context */
    }
    return text;
  }

  // ─── Token-limit retry ────────────────────────────────────────────

  private async scheduleRetry(task: Task, resetAt?: number): Promise<void> {
    const settings = this.getSettings();
    const fallbackMs = (settings.tokenLimitFallbackMinutes ?? 60) * 60_000;
    const raw = resetAt != null ? resetAt - Date.now() + RETRY_BUFFER_MS : fallbackMs;
    const delay = Math.min(Math.max(raw, RETRY_MIN_DELAY_MS), RETRY_MAX_DELAY_MS);
    const runAt = Date.now() + delay;

    this.cancelRetry(task.id);

    const updated = await this.repo.update(task.id, { retryAt: runAt });
    if (updated) broadcastTaskUpdate(updated);

    this.emitNotice(
      task.id,
      task.agentType,
      `Token/usage limit detected for ${task.agentType ?? 'agent'} — auto-retrying around ${new Date(runAt).toLocaleString()} (in ${formatDelay(delay)})${resetAt != null ? '' : ' (no reset time found; using fallback delay)'}.`,
    );
    console.log(`[scheduler] task ${task.id} token-limited; retry in ${Math.round(delay / 1000)}s`);

    const timer = setTimeout(() => {
      void this.fireRetry(task.id).catch((err) =>
        console.error('[scheduler] fireRetry failed:', errorMessage(err)),
      );
    }, delay);
    timer.unref?.();
    this.retryTimers.set(task.id, timer);
  }

  private async fireRetry(taskId: string): Promise<void> {
    this.retryTimers.delete(taskId);
    if (this.stopped) return;

    const task = await this.repo.getById(taskId);
    if (!task) return;
    // A manual run/move/delete clears retryAt; respect that and do nothing.
    if (task.retryAt == null) return;
    if (this.agentManager.isRunning(taskId)) return;

    // Only retry a still-failed task. If it was completed/moved meanwhile, just
    // clear the stale marker.
    const settings = this.getSettings();
    if (!settings.tokenLimitRetryEnabled || task.agentStatus !== 'failed') {
      const cleared = await this.repo.update(taskId, { retryAt: undefined });
      if (cleared) broadcastTaskUpdate(cleared);
      return;
    }

    this.emitNotice(taskId, task.agentType, 'Token/usage limit window passed — retrying task now.');
    await this.runTaskById(task);
  }

  // ─── Auto-pickup ──────────────────────────────────────────────────

  private kickAllProjects(): void {
    if (this.stopped || !this.getSettings().autoPickupEnabled) return;
    void (async () => {
      try {
        const projects = await this.projectRepo.getAllWithCounts();
        for (const project of projects) await this.tryPickup(project.id);
      } catch (err) {
        console.error('[scheduler] kickAllProjects failed:', errorMessage(err));
      }
    })();
  }

  private async tryPickup(projectId: string): Promise<void> {
    if (this.stopped) return;
    const settings = this.getSettings();
    if (!settings.autoPickupEnabled) return;
    if (this.pickupInFlight.has(projectId)) return;
    this.pickupInFlight.add(projectId);
    try {
      // Without an available agent, leave tasks queued rather than failing them.
      if (!this.agentManager.getAvailableAgents().some((a) => a.available)) return;

      // getAll excludes archived tasks and group children.
      const tasks = await this.repo.getAll(false, projectId);
      const busy = tasks.some(
        (t) => this.agentManager.isRunning(t.id) || this.launching.has(t.id) || this.retryTimers.has(t.id),
      );
      if (busy) return;

      const candidates = tasks.filter((t) => t.columnId === 'backlog' && t.agentStatus === 'idle');
      if (candidates.length === 0) return;
      candidates.sort(pickupOrder);
      const next = candidates[0];

      this.launching.add(next.id);
      try {
        await this.runTaskById(next);
        console.log(`[scheduler] auto-picked task ${next.id} "${next.title}" in project ${projectId}`);
      } finally {
        this.launching.delete(next.id);
      }
    } catch (err) {
      console.error(`[scheduler] tryPickup(${projectId}) failed:`, errorMessage(err));
    } finally {
      this.pickupInFlight.delete(projectId);
    }
  }

  // ─── Shared run path ──────────────────────────────────────────────

  /** Start an agent for a task (mirrors POST /run): reset events, mark planning,
   *  clear any retry marker, move backlog → in-progress, then launch. */
  private async runTaskById(task: Task): Promise<void> {
    if (this.agentManager.isRunning(task.id)) return;
    this.agentManager.resetEvents(task.id);

    const updates: Partial<Task> = {
      agentStatus: 'planning',
      startedAt: Date.now(),
      completedAt: undefined,
      retryAt: undefined,
    };
    if (task.columnId === 'backlog') updates.columnId = 'in-progress';

    const updated = await this.repo.update(task.id, updates);
    if (!updated) return;
    broadcastTaskUpdate(updated);

    this.agentManager.startAgent(
      updated,
      makeStatusCallback(this.repo, task.id, this.agentManager),
    );
  }

  /** Re-arm timers for tasks that had a retry scheduled before a restart. */
  private async rearmPersistedRetries(): Promise<void> {
    try {
      const projects = await this.projectRepo.getAllWithCounts();
      for (const project of projects) {
        const tasks = await this.repo.getAll(false, project.id);
        for (const task of tasks) {
          if (task.retryAt == null || task.agentStatus !== 'failed') continue;
          const delay = Math.min(Math.max(task.retryAt - Date.now(), RETRY_MIN_DELAY_MS), RETRY_MAX_DELAY_MS);
          const timer = setTimeout(() => {
            void this.fireRetry(task.id).catch((err) =>
              console.error('[scheduler] fireRetry failed:', errorMessage(err)),
            );
          }, delay);
          timer.unref?.();
          this.retryTimers.set(task.id, timer);
          console.log(`[scheduler] re-armed retry for task ${task.id} in ${Math.round(delay / 1000)}s`);
        }
      }
    } catch (err) {
      console.error('[scheduler] rearmPersistedRetries failed:', errorMessage(err));
    }
  }

  // ─── Events ───────────────────────────────────────────────────────

  /** Persist + broadcast an informational event on a task's timeline. */
  private emitNotice(taskId: string, agentType: AgentType | undefined, content: string): void {
    const event = {
      id: uuid(),
      taskId,
      type: 'output' as const,
      content,
      timestamp: Date.now(),
      metadata: { phase: 'scheduler', ...(agentType ? { agentType } : {}) },
    };
    this.repo.insertEvent(event).catch((err: unknown) =>
      console.error('[scheduler] failed to persist notice:', errorMessage(err)),
    );
    broadcast({ type: 'agent_event', payload: event });
  }
}
