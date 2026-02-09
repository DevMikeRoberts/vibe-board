import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import type { Task, AgentEvent } from '../types.js';
import { broadcast } from '../websocket.js';
import {
  CopilotClient,
  type CopilotSession,
  type SessionEvent,
} from '@github/copilot-sdk';

// Singleton CopilotClient (lazy-initialized with explicit start)
let copilotClient: CopilotClient | null = null;
let clientReady: Promise<CopilotClient> | null = null;

async function getClient(): Promise<CopilotClient> {
  if (clientReady) return clientReady;

  clientReady = (async () => {
    copilotClient = new CopilotClient({
      logLevel: 'info',
      autoRestart: true,
    });
    await copilotClient.start();
    console.log('[copilot] SDK client started');
    return copilotClient;
  })();

  return clientReady;
}

// Active agent sessions keyed by taskId
const sessions = new Map<string, { session: CopilotSession; unsubscribe: () => void }>();

// Event log per task (capped to prevent unbounded growth)
const MAX_EVENTS_PER_TASK = 100;
const eventLogs = new Map<string, AgentEvent[]>();

function emitEvent(taskId: string, event: AgentEvent): void {
  let log = eventLogs.get(taskId) || [];
  log.push(event);
  if (log.length > MAX_EVENTS_PER_TASK) {
    log = log.slice(-MAX_EVENTS_PER_TASK);
  }
  eventLogs.set(taskId, log);
  broadcast({ type: 'agent_event', payload: event });
}

export function getEvents(taskId: string): AgentEvent[] {
  return eventLogs.get(taskId) || [];
}

/**
 * Set up a git worktree for the task if configured.
 * Returns the worktree path if created, or undefined.
 */
export function setupWorktree(task: Task): string | undefined {
  if (!task.useWorktree || !task.repoPath || !task.branchName) return undefined;

  const worktreePath = `/tmp/kanban-${task.id}`;
  const baseBranch = task.baseBranch || 'main';

  try {
    execFileSync(
      'git', ['worktree', 'add', '-b', task.branchName, worktreePath, baseBranch],
      { cwd: task.repoPath, stdio: 'pipe' }
    );
    console.log(`[worktree] created at ${worktreePath} from ${baseBranch}`);
    return worktreePath;
  } catch (err: any) {
    // Branch may already exist — try without -b
    try {
      execFileSync(
        'git', ['worktree', 'add', worktreePath, task.branchName],
        { cwd: task.repoPath, stdio: 'pipe' }
      );
      console.log(`[worktree] attached existing branch ${task.branchName} at ${worktreePath}`);
      return worktreePath;
    } catch (err2: any) {
      console.error(`[worktree] failed:`, err2.message);
      throw new Error(`Failed to create worktree: ${err2.message}`);
    }
  }
}

/**
 * Remove a git worktree and optionally the branch.
 */
export function removeWorktree(task: Task): void {
  if (!task.worktreePath || !task.repoPath) return;
  try {
    execFileSync('git', ['worktree', 'remove', task.worktreePath, '--force'], {
      cwd: task.repoPath,
      stdio: 'pipe',
    });
    console.log(`[worktree] removed ${task.worktreePath}`);
  } catch (err: any) {
    console.error(`[worktree] remove failed:`, err.message);
  }
}

/**
 * Create a PR from the worktree branch using gh CLI.
 */
export function createPR(task: Task): { url: string } {
  if (!task.repoPath || !task.branchName) {
    throw new Error('Task has no repo path or branch name configured');
  }

  const baseBranch = task.baseBranch || 'main';
  const cwd = task.worktreePath || task.repoPath;

  try {
    // Push branch first
    execFileSync('git', ['push', '-u', 'origin', task.branchName], { cwd, stdio: 'pipe' });

    // Create PR
    const result = execFileSync(
      'gh',
      ['pr', 'create', '--base', baseBranch, '--head', task.branchName,
       '--title', task.title, '--body', `Automated PR from Kanban task ${task.id}`],
      { cwd, stdio: 'pipe' }
    );
    const url = result.toString().trim();
    console.log(`[pr] created: ${url}`);
    return { url };
  } catch (err: any) {
    console.error(`[pr] creation failed:`, err.message);
    throw new Error(`PR creation failed: ${err.stderr?.toString() || err.message}`);
  }
}

/**
 * Map a Copilot SDK SessionEvent to our AgentEvent and emit it.
 */
function mapAndEmitSessionEvent(taskId: string, event: SessionEvent): void {
  switch (event.type) {
    case 'assistant.turn_start':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'thinking',
        content: 'Starting a new turn...',
        timestamp: Date.now(),
      });
      break;

    case 'assistant.intent':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'thinking',
        content: event.data.intent,
        timestamp: Date.now(),
      });
      break;

    case 'assistant.reasoning_delta':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'thinking',
        content: event.data.deltaContent,
        timestamp: Date.now(),
      });
      break;

    case 'assistant.message':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'complete',
        content: event.data.content,
        timestamp: Date.now(),
      });
      break;

    case 'assistant.message_delta':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'output',
        content: event.data.deltaContent,
        timestamp: Date.now(),
      });
      break;

    case 'tool.execution_start':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'command',
        content: `${event.data.toolName}: ${JSON.stringify(event.data.arguments ?? '')}`,
        timestamp: Date.now(),
        metadata: { command: event.data.toolName },
      });
      break;

    case 'tool.execution_complete':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'output',
        content: event.data.result?.content ?? event.data.error?.message ?? '',
        timestamp: Date.now(),
      });
      break;

    case 'tool.execution_partial_result':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'output',
        content: event.data.partialOutput,
        timestamp: Date.now(),
      });
      break;

    case 'session.error':
      emitEvent(taskId, {
        id: uuid(),
        taskId,
        type: 'error',
        content: event.data.message,
        timestamp: Date.now(),
      });
      break;

    // session.idle is handled in startAgent to trigger status change
    default:
      break;
  }
}

export function startAgent(
  task: Task,
  onStatusChange: (status: Task['agentStatus']) => void,
  onWorktreeCreated?: (worktreePath: string) => void,
): void {
  if (sessions.has(task.id)) return;

  // Set up worktree if configured — capture path locally since the callback
  // updates the DB but not this local task reference
  let worktreePath: string | undefined;
  if (task.useWorktree) {
    try {
      worktreePath = setupWorktree(task);
      if (worktreePath) {
        task.worktreePath = worktreePath; // Also set on task for consistency
        if (onWorktreeCreated) onWorktreeCreated(worktreePath);
        emitEvent(task.id, {
          id: uuid(),
          taskId: task.id,
          type: 'output',
          content: `Git worktree created at ${worktreePath}\nBranch: ${task.branchName}\nBase: ${task.baseBranch || 'main'}`,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      emitEvent(task.id, {
        id: uuid(),
        taskId: task.id,
        type: 'error',
        content: `Worktree setup failed: ${err.message}`,
        timestamp: Date.now(),
      });
      onStatusChange('failed');
      return;
    }
  }

  // Launch the Copilot session asynchronously
  (async () => {
    try {
      const client = await getClient();
      const workingDirectory = worktreePath || task.repoPath || process.cwd();

      if (worktreePath) console.log(`[copilot] using worktree: ${worktreePath}`);
      
      const session = await client.createSession({
        model: process.env.COPILOT_MODEL || 'claude-sonnet-4-20250514',
        streaming: true,
        workingDirectory,
        systemMessage: {
          mode: 'append' as const,
          content: `
<context>
You are a coding agent working on a task in the project directory: ${workingDirectory}
Task: ${task.title}
${worktreePath ? `\nIMPORTANT: All file paths MUST be under ${worktreePath}. Do NOT reference or edit files at ${task.repoPath} directly.` : ''}
Complete the task described in the user prompt. Be thorough — read relevant files,
make precise edits, and verify your changes compile/pass tests when applicable.
</context>
`,
        },
        onPermissionRequest: () => ({ kind: 'approved' as const }),
        ...(worktreePath && task.repoPath
          ? {
              hooks: {
                onPreToolUse: (input: { toolName: string; toolArgs: unknown; cwd: string }) => {
                  const repoPrefix = task.repoPath!;
                  const wtPrefix = worktreePath!;
                  // Rewrite file paths from original repo to worktree
                  
                  if (!input.toolArgs || typeof input.toolArgs !== 'object') return {};
                  
                  const args = input.toolArgs as Record<string, unknown>;
                  const modifiedArgs: Record<string, unknown> = {};
                  let changed = false;
                  
                  // Deep rewrite: check all string values recursively
                  function rewriteValue(val: unknown): unknown {
                    if (typeof val === 'string' && val.includes(repoPrefix)) {
                      changed = true;
                      return val.replaceAll(repoPrefix, wtPrefix);
                    }
                    if (Array.isArray(val)) return val.map(rewriteValue);
                    if (val && typeof val === 'object') {
                      const obj: Record<string, unknown> = {};
                      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                        obj[k] = rewriteValue(v);
                      }
                      return obj;
                    }
                    return val;
                  }
                  
                  for (const [key, value] of Object.entries(args)) {
                    modifiedArgs[key] = rewriteValue(value);
                  }
                  
                  if (changed) {
                    return { modifiedArgs };
                  }
                  return {};
                },
              },
            }
          : {}),
      });

      // Subscribe to all session events — capture unsubscribe for cleanup
      const unsubscribe = session.on((event: SessionEvent) => {
        mapAndEmitSessionEvent(task.id, event);

        // Backup completion trigger: if sendAndWait somehow misses, idle means done
        if (event.type === 'session.idle') {
          if (sessions.has(task.id)) {
            console.log(`[copilot] session.idle for task ${task.id} (backup completion)`);
            onStatusChange('complete');
            const entry = sessions.get(task.id);
            if (entry) {
              entry.unsubscribe();
              sessions.delete(task.id);
            }
            session.destroy().catch(() => {});
          }
        }
      });

      sessions.set(task.id, { session, unsubscribe });
      onStatusChange('executing');

      // Build prompt and send — sendAndWait blocks until session is idle
      const prompt = `${task.title}\n\n${task.description}`;
      console.log(`[copilot] sending prompt for task ${task.id}`);
      await session.sendAndWait({ prompt });
      console.log(`[copilot] sendAndWait completed for task ${task.id}`);

      // Primary completion path — clean up and mark done
      if (sessions.has(task.id)) {
        const entry = sessions.get(task.id);
        if (entry) entry.unsubscribe();
        sessions.delete(task.id);
        onStatusChange('complete');
        session.destroy().catch(() => {});
      }
    } catch (err: any) {
      const message = err.message || String(err);
      const isCliMissing =
        message.includes('ENOENT') ||
        message.includes('not found') ||
        message.includes('spawn');

      emitEvent(task.id, {
        id: uuid(),
        taskId: task.id,
        type: 'error',
        content: isCliMissing
          ? 'GitHub Copilot CLI is not installed or not found in PATH. Install with: gh extension install github/gh-copilot'
          : `Failed to start Copilot session: ${message}`,
        timestamp: Date.now(),
      });

      // Clean up session if it was registered before the error
      const entry = sessions.get(task.id);
      if (entry) {
        entry.unsubscribe();
        sessions.delete(task.id);
      }
      onStatusChange('failed');
    }
  })();
}

export function stopAgent(taskId: string): boolean {
  const entry = sessions.get(taskId);
  if (!entry) return false;

  entry.unsubscribe();
  sessions.delete(taskId);

  // Abort and destroy in background
  (async () => {
    try { await entry.session.abort(); } catch {}
    try { await entry.session.destroy(); } catch {}
  })();

  const event: AgentEvent = {
    id: uuid(),
    taskId,
    type: 'error',
    content: 'Agent stopped by user.',
    timestamp: Date.now(),
  };
  emitEvent(taskId, event);
  return true;
}

export function isRunning(taskId: string): boolean {
  return sessions.has(taskId);
}

export function clearEvents(taskId: string): void {
  eventLogs.delete(taskId);
}

export function shutdownAll(): void {
  for (const [id, entry] of sessions) {
    entry.unsubscribe();
    // Fire-and-forget abort + destroy
    (async () => {
      try { await entry.session.abort(); } catch {}
      try { await entry.session.destroy(); } catch {}
    })();
    sessions.delete(id);
  }

  if (copilotClient) {
    const client = copilotClient;
    copilotClient = null;
    clientReady = null;
    // Fire-and-forget client shutdown
    client.stop().catch(() => {});
  }
}
