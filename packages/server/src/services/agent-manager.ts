import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Task, AgentEvent, AgentType } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { AgentProvider, AgentSession, AgentInfo } from '@agent-sdk/core';
import type { AgentEvent as CoreAgentEvent } from '@agent-sdk/core';
import { CopilotProvider, ClaudeProvider, CodexProvider, detectAgents } from '@agent-sdk/core';
import { broadcast } from '../websocket.js';

const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '600000', 10);

interface ManagedSession {
  session: AgentSession;
  timeoutId?: ReturnType<typeof setTimeout>;
  startTime: number;
  agentType: AgentType;
}

// Event log per task (capped to prevent unbounded growth)
const MAX_EVENTS_PER_TASK = 100;
const MAX_EVENT_LOG_TASKS = 200;

// Deleted-task guard TTL
const DELETED_TASK_TTL_MS = 60_000;

export class AgentManager {
  private providers = new Map<AgentType, AgentProvider>();
  private sessions = new Map<string, ManagedSession>();
  private deletedTasks = new Set<string>();
  /** Tasks stopped by user — prevents duplicate agent_complete from terminateOnce */
  private stoppedTasks = new Set<string>();
  private eventLogs = new Map<string, AgentEvent[]>();
  private eventRepo: TaskRepository | null = null;
  private availableAgents: AgentInfo[] = [];

  /** Call once at startup to enable event persistence. */
  initEventPersistence(repo: TaskRepository): void {
    this.eventRepo = repo;
  }

  /** Detect available agents, register providers, start the ones that are available. */
  async initialize(): Promise<void> {
    // Register all providers
    this.providers.set('copilot', new CopilotProvider());
    this.providers.set('claude', new ClaudeProvider());
    this.providers.set('codex', new CodexProvider());

    // Detect which agents are actually available on this system
    this.availableAgents = await detectAgents();
    const available = this.availableAgents.filter(a => a.available);

    console.log(
      `[agent-manager] detected agents: ${this.availableAgents.map(a => `${a.displayName}=${a.available ? 'yes' : 'no'}`).join(', ')}`
    );

    // Start available providers
    for (const info of available) {
      const provider = this.providers.get(info.name);
      if (provider) {
        try {
          await provider.start();
        } catch (err: unknown) {
          console.error(`[agent-manager] failed to start ${info.displayName}: ${err instanceof Error ? err.message : String(err)}`);
          // Mark as unavailable
          const agentInfo = this.availableAgents.find(a => a.name === info.name);
          if (agentInfo) {
            agentInfo.available = false;
            agentInfo.reason = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      }
    }
  }

  getAvailableAgents(): AgentInfo[] {
    return [...this.availableAgents];
  }

  // ─── Event Management (moved from copilot.ts) ─────────────────────

  private emitEvent(taskId: string, event: AgentEvent): void {
    if (this.deletedTasks.has(taskId)) return;

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
        console.error(`[agent-manager] failed to persist event: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    broadcast({ type: 'agent_event', payload: event });
  }

  async getEvents(taskId: string): Promise<AgentEvent[]> {
    const memEvents = this.eventLogs.get(taskId);
    if (memEvents && memEvents.length > 0) {
      this.eventLogs.delete(taskId);
      this.eventLogs.set(taskId, memEvents);
      return [...memEvents];
    }
    if (this.eventRepo) {
      const dbEvents = await this.eventRepo.getEventsByTaskId(taskId);
      if (dbEvents.length > 0) {
        this.eventLogs.set(taskId, dbEvents);
      }
      return dbEvents;
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
        console.error(`[agent-manager] failed to delete persisted events: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // ─── Worktree Management (moved from copilot.ts) ──────────────────

  setupWorktree(task: Task): string | undefined {
    if (!task.useWorktree || !task.repoPath || !task.branchName) return undefined;

    const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-${task.id}-`));
    const baseBranch = task.baseBranch || 'main';

    try {
      execFileSync(
        'git', ['worktree', 'add', '-b', task.branchName, worktreePath, baseBranch],
        { cwd: task.repoPath, stdio: 'pipe' },
      );
      console.log(`[worktree] created at ${worktreePath} from ${baseBranch}`);
      return worktreePath;
    } catch {
      try {
        execFileSync(
          'git', ['worktree', 'add', worktreePath, task.branchName],
          { cwd: task.repoPath, stdio: 'pipe' },
        );
        console.log(`[worktree] attached existing branch ${task.branchName} at ${worktreePath}`);
        return worktreePath;
      } catch (err2: unknown) {
        console.error(`[worktree] failed:`, err2 instanceof Error ? err2.message : String(err2));
        throw new Error(`Failed to create worktree: ${err2 instanceof Error ? err2.message : String(err2)}`);
      }
    }
  }

  removeWorktree(task: Task): void {
    if (!task.worktreePath || !task.repoPath) return;
    try {
      execFileSync('git', ['worktree', 'remove', task.worktreePath, '--force'], {
        cwd: task.repoPath,
        stdio: 'pipe',
      });
      console.log(`[worktree] removed ${task.worktreePath}`);
    } catch (err: unknown) {
      console.error(`[worktree] remove failed:`, err instanceof Error ? err.message : String(err));
      throw new Error(`Failed to remove worktree: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  createPR(task: Task): { url: string } {
    if (!task.repoPath || !task.branchName) {
      throw new Error('Task has no repo path or branch name configured');
    }
    const baseBranch = task.baseBranch || 'main';
    const cwd = task.worktreePath || task.repoPath;

    try {
      execFileSync('git', ['push', '-u', 'origin', task.branchName], { cwd, stdio: 'pipe' });
      const result = execFileSync(
        'gh',
        ['pr', 'create', '--base', baseBranch, '--head', task.branchName,
         '--title', task.title, '--body', `Automated PR from Kanban task ${task.id}`, '--'],
        { cwd, stdio: 'pipe' },
      );
      const url = result.toString().trim();
      console.log(`[pr] created: ${url}`);
      return { url };
    } catch (err: unknown) {
      console.error(`[pr] creation failed:`, err instanceof Error ? err.message : String(err));
      throw new Error(`PR creation failed: ${err instanceof Error && 'stderr' in err ? err.stderr?.toString() : err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Session Lifecycle ─────────────────────────────────────────────

  startAgent(
    task: Task,
    onStatusChange: (status: Task['agentStatus']) => void | Promise<void>,
    onWorktreeCreated?: (worktreePath: string) => void | Promise<void>,
  ): void {
    if (this.sessions.has(task.id)) return;

    const agentType = task.agentType || 'copilot';
    const provider = this.providers.get(agentType);
    if (!provider) {
      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'error',
        content: `No provider registered for agent type: ${agentType}`,
        timestamp: Date.now(),
      });
      onStatusChange('failed');
      return;
    }

    // Check if agent is available
    const agentInfo = this.availableAgents.find(a => a.name === agentType);
    if (!agentInfo?.available) {
      this.emitEvent(task.id, {
        id: uuid(), taskId: task.id, type: 'error',
        content: `Agent ${provider.displayName} is not available: ${agentInfo?.reason || 'unknown reason'}`,
        timestamp: Date.now(),
      });
      onStatusChange('failed');
      return;
    }

    // Track start time for duration reporting
    const sessionStartTime = Date.now();

    // Guard for single terminal state (complete OR failed — prevents races)
    let terminated = false;
    const terminateOnce = async (status: 'complete' | 'failed', errorMessage?: string) => {
      if (terminated) return;
      // If the task was stopped by the user, stopAgent already handled cleanup
      if (this.stoppedTasks.has(task.id)) { terminated = true; return; }
      terminated = true;
      const entry = this.sessions.get(task.id);
      if (entry?.timeoutId) clearTimeout(entry.timeoutId);
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
    };

    // Set up worktree if configured
    let worktreePath: string | undefined;
    if (task.useWorktree) {
      try {
        worktreePath = this.setupWorktree(task);
        if (worktreePath) {
          task.worktreePath = worktreePath;
          if (onWorktreeCreated) onWorktreeCreated(worktreePath);
          this.emitEvent(task.id, {
            id: uuid(), taskId: task.id, type: 'output',
            content: `Git worktree created at ${worktreePath}\nBranch: ${task.branchName}\nBase: ${task.baseBranch || 'main'}`,
            timestamp: Date.now(),
          });
        }
      } catch (err: unknown) {
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'error',
          content: `Worktree setup failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
        terminateOnce('failed', `Worktree setup failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    // Launch the agent session asynchronously
    (async () => {
      try {
        const workingDirectory = worktreePath || task.repoPath || process.cwd();
        const hasGit = fs.existsSync(path.join(workingDirectory, '.git'));
        const systemPrompt = `
<context>
You are a coding agent working on a task in the project directory: ${workingDirectory}
Task: ${task.title}
${worktreePath ? `\nIMPORTANT: All file paths MUST be under ${worktreePath}. Do NOT reference or edit files at ${task.repoPath} directly.` : ''}
${!hasGit ? `\nIMPORTANT: This directory is not a git repository. Run \`git init\` first before making any changes, so all work is tracked.` : ''}
Complete the task described in the user prompt. Be thorough — read relevant files,
make precise edits, and verify your changes compile/pass tests when applicable.
</context>
`;

        const session = await provider.createSession({
          contextId: task.id,
          workingDirectory,
          repoPath: task.repoPath,
          systemPrompt,
          onEvent: (coreEvent: CoreAgentEvent) => this.emitEvent(task.id, {
            id: coreEvent.id,
            taskId: task.id,
            type: coreEvent.type,
            content: coreEvent.content,
            timestamp: coreEvent.timestamp,
            metadata: coreEvent.metadata,
          }),
        });

        this.sessions.set(task.id, { session, startTime: sessionStartTime, agentType });
        onStatusChange('executing');

        // Timeout guard
        const timeoutId = setTimeout(() => {
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
            entry.session.abort().catch(() => {});
            entry.session.destroy().catch(() => {});
          }
          terminateOnce('failed', timeoutMsg);
        }, AGENT_TIMEOUT_MS);

        const entry = this.sessions.get(task.id);
        if (entry) entry.timeoutId = timeoutId;

        // Build prompt and execute — each provider returns a typed AgentResult
        const prompt = `${task.title}\n\n${task.description}`;
        console.log(`[agent-manager] executing ${agentType} for task ${task.id}`);
        const result = await session.execute(prompt);
        console.log(`[agent-manager] ${agentType} ${result.status} for task ${task.id}${result.error ? `: ${result.error}` : ''}`);

        clearTimeout(timeoutId);

        // Primary completion path — status comes from the provider
        if (this.sessions.has(task.id)) {
          this.sessions.delete(task.id);
          terminateOnce(result.status, result.error);
          session.destroy().catch(() => {});
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
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

  async sendMessage(taskId: string, message: string): Promise<boolean> {
    const entry = this.sessions.get(taskId);
    if (!entry) return false;

    this.emitEvent(taskId, {
      id: uuid(), taskId, type: 'command',
      content: `Follow-up message sent: ${message}`,
      timestamp: Date.now(),
    });

    try {
      await entry.session.send(message);
    } catch (err: unknown) {
      const providerName = this.providers.get(entry.agentType)?.displayName || entry.agentType;
      throw new Error(`${providerName} failed to process follow-up: ${err instanceof Error ? err.message : String(err)}`);
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
    setTimeout(() => this.stoppedTasks.delete(taskId), 30_000);

    (async () => {
      try { await entry.session.abort(); } catch { /* ignore */ }
      try { await entry.session.destroy(); } catch { /* ignore */ }
    })();

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
        try { await entry.session.abort(); } catch { /* ignore */ }
        try { await entry.session.destroy(); } catch { /* ignore */ }
      })();
    }

    for (const provider of this.providers.values()) {
      provider.stop().catch(() => {});
    }
  }
}
