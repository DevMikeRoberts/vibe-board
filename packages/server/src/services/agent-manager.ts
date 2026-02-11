import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Task, AgentEvent, AgentType } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { AgentProvider, AgentSession } from '../agents/base.js';
import type { AgentInfo } from '../agents/detection.js';
import { detectAgents } from '../agents/detection.js';
import { CopilotProvider } from '../agents/copilot.js';
import { ClaudeProvider } from '../agents/claude.js';
import { CodexProvider } from '../agents/codex.js';
import { broadcast } from '../websocket.js';

const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '600000', 10);

interface ManagedSession {
  session: AgentSession;
  timeoutId?: ReturnType<typeof setTimeout>;
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
        } catch (err: any) {
          console.error(`[agent-manager] failed to start ${info.displayName}: ${err.message}`);
          // Mark as unavailable
          const agentInfo = this.availableAgents.find(a => a.name === info.name);
          if (agentInfo) {
            agentInfo.available = false;
            agentInfo.reason = `Failed to start: ${err.message}`;
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
    // Write-through to SQLite
    if (this.eventRepo) {
      try {
        this.eventRepo.insertEvent(event);
      } catch (err: any) {
        console.error(`[agent-manager] failed to persist event: ${err.message}`);
      }
    }
    broadcast({ type: 'agent_event', payload: event });
  }

  getEvents(taskId: string): AgentEvent[] {
    const memEvents = this.eventLogs.get(taskId);
    if (memEvents && memEvents.length > 0) {
      this.eventLogs.delete(taskId);
      this.eventLogs.set(taskId, memEvents);
      return [...memEvents];
    }
    if (this.eventRepo) {
      const dbEvents = this.eventRepo.getEventsByTaskId(taskId);
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
    this.eventLogs.delete(taskId);
    if (this.eventRepo) {
      try {
        this.eventRepo.deleteEventsByTaskId(taskId);
      } catch (err: any) {
        console.error(`[agent-manager] failed to delete persisted events: ${err.message}`);
      }
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
      } catch (err2: any) {
        console.error(`[worktree] failed:`, err2.message);
        throw new Error(`Failed to create worktree: ${err2.message}`);
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
    } catch (err: any) {
      console.error(`[worktree] remove failed:`, err.message);
      throw new Error(`Failed to remove worktree: ${err.message}`);
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
    } catch (err: any) {
      console.error(`[pr] creation failed:`, err.message);
      throw new Error(`PR creation failed: ${err.stderr?.toString() || err.message}`);
    }
  }

  // ─── Session Lifecycle ─────────────────────────────────────────────

  startAgent(
    task: Task,
    onStatusChange: (status: Task['agentStatus']) => void,
    onWorktreeCreated?: (worktreePath: string) => void,
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

    // Guard for single completion
    let completed = false;
    const completeOnce = () => {
      if (completed) return;
      completed = true;
      const entry = this.sessions.get(task.id);
      if (entry?.timeoutId) clearTimeout(entry.timeoutId);
      onStatusChange('complete');
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
      } catch (err: any) {
        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'error',
          content: `Worktree setup failed: ${err.message}`,
          timestamp: Date.now(),
        });
        onStatusChange('failed');
        return;
      }
    }

    // Launch the agent session asynchronously
    (async () => {
      try {
        const workingDirectory = worktreePath || task.repoPath || process.cwd();
        const systemPrompt = `
<context>
You are a coding agent working on a task in the project directory: ${workingDirectory}
Task: ${task.title}
${worktreePath ? `\nIMPORTANT: All file paths MUST be under ${worktreePath}. Do NOT reference or edit files at ${task.repoPath} directly.` : ''}
Complete the task described in the user prompt. Be thorough — read relevant files,
make precise edits, and verify your changes compile/pass tests when applicable.
</context>
`;

        const session = await provider.createSession({
          taskId: task.id,
          workingDirectory,
          systemPrompt,
          onEvent: (event) => this.emitEvent(task.id, event),
        });

        this.sessions.set(task.id, { session });
        onStatusChange('executing');

        // Timeout guard
        const timeoutId = setTimeout(() => {
          if (!this.sessions.has(task.id)) return;
          console.warn(`[agent-manager] task ${task.id} timed out after ${AGENT_TIMEOUT_MS}ms`);
          this.emitEvent(task.id, {
            id: uuid(), taskId: task.id, type: 'error',
            content: `Agent timed out after ${Math.round(AGENT_TIMEOUT_MS / 60000)} minutes`,
            timestamp: Date.now(),
          });
          const entry = this.sessions.get(task.id);
          if (entry) {
            this.sessions.delete(task.id);
            entry.session.abort().catch(() => {});
            entry.session.destroy().catch(() => {});
          }
          onStatusChange('failed');
        }, AGENT_TIMEOUT_MS);

        const entry = this.sessions.get(task.id);
        if (entry) entry.timeoutId = timeoutId;

        // Build prompt and execute
        const prompt = `${task.title}\n\n${task.description}`;
        console.log(`[agent-manager] executing ${agentType} for task ${task.id}`);
        await session.execute(prompt);
        console.log(`[agent-manager] ${agentType} completed for task ${task.id}`);

        clearTimeout(timeoutId);

        // Primary completion path
        if (this.sessions.has(task.id)) {
          this.sessions.delete(task.id);
          completeOnce();
          session.destroy().catch(() => {});
        }
      } catch (err: any) {
        const message = err.message || String(err);
        const isCliMissing =
          message.includes('ENOENT') ||
          message.includes('not found') ||
          message.includes('spawn');

        this.emitEvent(task.id, {
          id: uuid(), taskId: task.id, type: 'error',
          content: isCliMissing
            ? `${provider.displayName} CLI is not installed or not found in PATH.`
            : `Failed to start ${provider.displayName} session: ${message}`,
          timestamp: Date.now(),
        });

        const entry = this.sessions.get(task.id);
        if (entry) this.sessions.delete(task.id);
        onStatusChange('failed');
      }
    })().catch((err) => {
      console.error(`[agent-manager] unhandled error for task ${task.id}:`, err);
      onStatusChange('failed');
    });
  }

  stopAgent(taskId: string): boolean {
    const entry = this.sessions.get(taskId);
    if (!entry) return false;

    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    this.sessions.delete(taskId);

    (async () => {
      try { await entry.session.abort(); } catch { /* ignore */ }
      try { await entry.session.destroy(); } catch { /* ignore */ }
    })();

    this.emitEvent(taskId, {
      id: uuid(), taskId, type: 'error',
      content: 'Agent stopped by user.',
      timestamp: Date.now(),
    });
    return true;
  }

  isRunning(taskId: string): boolean {
    return this.sessions.has(taskId);
  }

  shutdownAll(): void {
    for (const [id, entry] of this.sessions) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      (async () => {
        try { await entry.session.abort(); } catch { /* ignore */ }
        try { await entry.session.destroy(); } catch { /* ignore */ }
      })();
      this.sessions.delete(id);
    }

    for (const provider of this.providers.values()) {
      provider.stop().catch(() => {});
    }
  }
}
