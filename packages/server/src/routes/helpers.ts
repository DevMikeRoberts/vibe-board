import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Task, TaskGroup } from '../types.js';
import { isValidPriority, isValidColumnId, isValidAgentType, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '@ai-agent-board/shared/constants.js';
import { errorMessage } from '../utils.js';
import type { TaskRepository } from '../repositories/types.js';
import { broadcast } from '../websocket.js';
import type { AgentManager } from '../services/agent-manager.js';

// ─── Async handler wrapper ──────────────────────────────────────────

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** Wrap async Express handlers so rejected promises forward to the error middleware. */
export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Param helpers ──────────────────────────────────────────────────

export function paramId(req: Request): string {
  const id = req.params.id;
  return typeof id === 'string' ? id : id[0];
}

// ─── Git ref validation ─────────────────────────────────────────────

const GIT_REF_RE = /^[a-zA-Z0-9_/][a-zA-Z0-9_./-]*$/;
export function isValidGitRef(ref: string): boolean {
  return GIT_REF_RE.test(ref) && !ref.includes('..') && !ref.endsWith('.lock') && ref.length <= 200;
}

// ─── Repo-path validation ───────────────────────────────────────────

// Default whitelist when ALLOWED_REPO_ROOTS is unset: home dir + tmp.
// Prevents agents from accessing /etc, /proc, etc. in local dev.
const ALLOWED_REPO_ROOTS: string[] = process.env.ALLOWED_REPO_ROOTS
  ? process.env.ALLOWED_REPO_ROOTS.split(',').map((p) => p.trim()).filter(Boolean)
  : [os.homedir(), os.tmpdir()];

/** Canonicalize a path, falling back to path.resolve if it doesn't exist yet. */
function realOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function isAllowedRepoPath(repoPath: string): string | null {
  const resolved = realOrResolve(repoPath);

  const underAllowedRoot = ALLOWED_REPO_ROOTS.some((root) => {
    const realRoot = realOrResolve(root);
    return resolved === realRoot || resolved.startsWith(realRoot + path.sep);
  });
  if (!underAllowedRoot) {
    return `repoPath must be under one of: ${ALLOWED_REPO_ROOTS.join(', ')}`;
  }

  // Create directory if it doesn't exist; verify it's a directory if it does
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return `repoPath is not a directory: ${resolved}`;
    }
  } catch {
    try {
      fs.mkdirSync(resolved, { recursive: true });
      console.log(`[repo-path] created directory ${resolved}`);
    } catch (err: unknown) {
      return `Failed to create directory: ${errorMessage(err)}`;
    }
  }

  // Must have read/write access
  try {
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    return `No read/write access to: ${resolved}`;
  }

  // Initialize git repo if not already one
  const gitDir = path.join(resolved, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      execFileSync('git', ['init'], { cwd: resolved, stdio: 'pipe' });
      console.log(`[repo-path] initialized git repo at ${resolved}`);
    } catch (err: unknown) {
      return `Failed to initialize git repository: ${errorMessage(err)}`;
    }
  }

  return null;
}

export function expandTilde(p: string): string {
  if (!p.startsWith('~')) return p;
  const rest = p.slice(p.startsWith('~/') || p.startsWith('~\\') ? 2 : 1);
  return path.join(os.homedir(), rest);
}

// ─── Broadcast helpers ──────────────────────────────────────────────

export function broadcastTaskUpdate(task: Task): void {
  broadcast({ type: 'task_updated', payload: task });
}

export function broadcastGroupUpdate(group: TaskGroup): void {
  broadcast({ type: 'group_updated', payload: group });
}

// ─── Rate limiter ───────────────────────────────────────────────────

const RATE_LIMIT_MS = 5_000;
const RATE_LIMIT_CLEANUP_THRESHOLD = 100;
const agentActionTimestamps = new Map<string, number>();

export function isRateLimited(taskId: string): boolean {
  const now = Date.now();
  const last = agentActionTimestamps.get(taskId);
  if (last && now - last < RATE_LIMIT_MS) return true;
  agentActionTimestamps.set(taskId, now);
  if (agentActionTimestamps.size > RATE_LIMIT_CLEANUP_THRESHOLD) {
    for (const [id, ts] of agentActionTimestamps) {
      if (now - ts > RATE_LIMIT_MS) agentActionTimestamps.delete(id);
    }
  }
  return false;
}

// ─── Task field validation ──────────────────────────────────────────

export function validateTaskFields(body: Record<string, any>): string | null {
  const { title, description, priority, columnId, agentType, repoPath, branchName, baseBranch, useWorktree, autoRun } = body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return 'title is required and must be a non-empty string';
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return `title must be at most ${MAX_TITLE_LENGTH} characters`;
  }
  if (description !== undefined && typeof description !== 'string') {
    return 'description must be a string';
  }
  if (typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
    return `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`;
  }
  if (priority !== undefined && !isValidPriority(priority)) {
    return 'invalid priority: must be one of low, medium, high, critical';
  }
  if (columnId !== undefined && !isValidColumnId(columnId)) {
    return 'invalid columnId: must be one of backlog, in-progress, review, done';
  }
  if (agentType !== undefined && !isValidAgentType(agentType)) {
    return 'invalid agentType: must be one of copilot, claude, codex, opencode';
  }
  if (repoPath !== undefined && typeof repoPath !== 'string') {
    return 'repoPath must be a string';
  }
  if (typeof repoPath === 'string') {
    const expandedRepoPath = expandTilde(repoPath);
    if (!path.isAbsolute(expandedRepoPath)) {
      return 'repoPath must be an absolute path';
    }
    const repoErr = isAllowedRepoPath(expandedRepoPath);
    if (repoErr) return repoErr;
  }
  if (branchName !== undefined && typeof branchName !== 'string') {
    return 'branchName must be a string';
  }
  if (typeof branchName === 'string' && branchName !== '' && !isValidGitRef(branchName)) {
    return 'branchName contains invalid characters';
  }
  if (baseBranch !== undefined && typeof baseBranch !== 'string') {
    return 'baseBranch must be a string';
  }
  if (typeof baseBranch === 'string' && !isValidGitRef(baseBranch)) {
    return 'baseBranch contains invalid characters';
  }
  if (useWorktree !== undefined && typeof useWorktree !== 'boolean') {
    return 'useWorktree must be a boolean';
  }
  if (autoRun !== undefined && typeof autoRun !== 'boolean') {
    return 'autoRun must be a boolean';
  }
  return null;
}

// ─── Task builder ───────────────────────────────────────────────────

export function buildTask(body: Record<string, any>): Task {
  const { title, description, priority, columnId, agentType, repoPath, branchName, baseBranch, useWorktree } = body;
  return {
    id: uuid(),
    title,
    description: description || '',
    priority: priority || 'medium',
    columnId: columnId || 'backlog',
    agentStatus: 'idle',
    agentType: agentType || 'copilot',
    createdAt: Date.now(),
    repoPath: typeof repoPath === 'string' ? expandTilde(repoPath) : undefined,
    branchName: branchName || undefined,
    baseBranch: baseBranch || undefined,
    useWorktree: useWorktree ?? undefined,
  };
}

// ─── Agent lifecycle helpers ────────────────────────────────────────

export function makeStatusCallback(repo: TaskRepository, taskId: string): (status: Task['agentStatus']) => void {
  return async (status) => {
    const statusUpdates: Partial<Task> = { agentStatus: status };
    if (status === 'complete') {
      statusUpdates.completedAt = Date.now();
      statusUpdates.columnId = 'review';
    }
    const t = await repo.update(taskId, statusUpdates);
    if (t) broadcastTaskUpdate(t);
  };
}

export function makeWorktreeCallback(repo: TaskRepository, taskId: string): (worktreePath: string) => void {
  return async (worktreePath) => {
    const t = await repo.update(taskId, { worktreePath });
    if (t) broadcastTaskUpdate(t);
  };
}

export async function startAgentForTask(
  task: Task,
  repo: TaskRepository,
  agentManager: AgentManager,
): Promise<void> {
  const updates: Partial<Task> = {
    agentStatus: 'planning',
    startedAt: Date.now(),
    completedAt: undefined,
  };
  if (task.columnId === 'backlog') {
    updates.columnId = 'in-progress';
  }
  const updated = await repo.update(task.id, updates);
  if (updated) {
    broadcastTaskUpdate(updated);
    agentManager.startAgent(updated, makeStatusCallback(repo, task.id), makeWorktreeCallback(repo, task.id));
  }
}
