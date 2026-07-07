import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Project, Task, TaskGroup } from '../types.js';
import { isValidPriority, isValidColumnId, isValidAgentType, VALID_AGENT_TYPES, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '@ai-agent-board/shared/constants.js';
import { errorMessage } from '../utils.js';
import { getCloneRoot, getConfig } from '../config.js';
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

const GIT_REF_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/;
export function isValidGitRef(ref: string): boolean {
  return GIT_REF_RE.test(ref) && !ref.includes('..') && !ref.endsWith('.lock') && ref.length <= 200;
}

// ─── Repo-path validation ───────────────────────────────────────────

// Default whitelist when ALLOWED_REPO_ROOTS is unset: home dir + tmp + this workspace.
// Prevents agents from accessing /etc, /proc, etc. while still allowing local dev repos.
const CONFIGURED_REPO_ROOTS: string[] = process.env.ALLOWED_REPO_ROOTS
  ? process.env.ALLOWED_REPO_ROOTS.split(',').map((p) => expandTilde(p.trim())).filter(Boolean)
  : getDefaultAllowedRepoRoots();

/**
 * Resolve the effective set of allowed repo roots. The configured clone root is
 * always included so that repos cloned from a URL pass validation even when
 * ALLOWED_REPO_ROOTS is explicitly set (e.g. in CI/e2e environments).
 */
function getAllowedRepoRoots(): string[] {
  try {
    return dedupePaths([...CONFIGURED_REPO_ROOTS, getCloneRoot()]);
  } catch {
    return CONFIGURED_REPO_ROOTS;
  }
}

function getDefaultAllowedRepoRoots(): string[] {
  const roots = [
    os.homedir(),
    os.tmpdir(),
    process.cwd(),
  ];

  if (process.env.PROJECTS_DIR) {
    roots.push(expandTilde(process.env.PROJECTS_DIR));
  }

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (workspaceRoot) {
    roots.push(workspaceRoot);
  }

  return dedupePaths(roots);
}

function findWorkspaceRoot(start: string): string | null {
  let current = path.resolve(start);

  for (let depth = 0; depth < 5; depth += 1) {
    const parent = path.dirname(current);
    if (
      path.basename(current) === 'server'
      && path.basename(parent) === 'packages'
      && fs.existsSync(path.join(path.dirname(parent), 'package.json'))
    ) {
      return path.dirname(parent);
    }
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    if (parent === current) return null;
    current = parent;
  }

  return null;
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of paths) {
    const resolved = realOrResolve(candidate);
    const key = normalizeForBoundaryCheck(resolved);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }

  return result;
}

/** Canonicalize a path, falling back to path.resolve if it doesn't exist yet. */
function realOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function normalizeForBoundaryCheck(p: string): string {
  const normalized = path.normalize(p);
  const root = path.parse(normalized).root;
  const withoutTrailingSeparators = normalized.length > root.length
    ? normalized.replace(/[\\/]+$/, '')
    : normalized;
  return process.platform === 'win32' ? withoutTrailingSeparators.toLowerCase() : withoutTrailingSeparators;
}

function isPathUnderRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeForBoundaryCheck(candidate);
  const normalizedRoot = normalizeForBoundaryCheck(root);
  const rootPath = normalizeForBoundaryCheck(path.parse(root).root);

  if (normalizedRoot === rootPath) {
    return normalizedCandidate.startsWith(normalizedRoot);
  }
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + path.sep);
}

export function isAllowedRepoPath(repoPath: string): string | null {
  const resolved = realOrResolve(repoPath);
  const roots = getAllowedRepoRoots();

  const underAllowedRoot = roots.some((root) => {
    const realRoot = realOrResolve(root);
    return isPathUnderRoot(resolved, realRoot);
  });
  if (!underAllowedRoot) {
    return `repoPath must be under one of: ${roots.join(', ')}`;
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

/**
 * Pure boundary check: returns null if `targetPath` resolves under an allowed
 * repo root, otherwise an error message. Unlike isAllowedRepoPath it has NO side
 * effects (no mkdir, no git init), making it safe to call on a prospective git
 * clone target before the directory exists.
 */
export function isUnderAllowedRoots(targetPath: string): string | null {
  const resolved = realOrResolve(targetPath);
  const roots = getAllowedRepoRoots();
  const ok = roots.some((root) => isPathUnderRoot(resolved, realOrResolve(root)));
  return ok ? null : `path must be under one of: ${roots.join(', ')}`;
}

export interface RepoPathValidation {
  repoPath: string;
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  error?: string;
  warning?: string;
}

export function validateRepoPath(repoPath: string): RepoPathValidation {
  const expanded = expandTilde(repoPath);
  if (!path.isAbsolute(expanded)) {
    return {
      repoPath: expanded,
      valid: false,
      exists: false,
      isDirectory: false,
      isGitRepo: false,
      error: 'repoPath must be an absolute path',
    };
  }

  const resolved = realOrResolve(expanded);
  const roots = getAllowedRepoRoots();
  const underAllowedRoot = roots.some((root) => isPathUnderRoot(resolved, realOrResolve(root)));
  if (!underAllowedRoot) {
    return {
      repoPath: resolved,
      valid: false,
      exists: false,
      isDirectory: false,
      isGitRepo: false,
      error: `repoPath must be under one of: ${roots.join(', ')}`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return {
      repoPath: resolved,
      valid: false,
      exists: false,
      isDirectory: false,
      isGitRepo: false,
      error: `repoPath does not exist: ${resolved}`,
    };
  }

  if (!stat.isDirectory()) {
    return {
      repoPath: resolved,
      valid: false,
      exists: true,
      isDirectory: false,
      isGitRepo: false,
      error: `repoPath is not a directory: ${resolved}`,
    };
  }

  try {
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err: unknown) {
    return {
      repoPath: resolved,
      valid: false,
      exists: true,
      isDirectory: true,
      isGitRepo: false,
      error: `No read/write access to: ${resolved}: ${errorMessage(err)}`,
    };
  }

  const isGitRepo = isGitWorkTree(resolved);
  return {
    repoPath: resolved,
    valid: true,
    exists: true,
    isDirectory: true,
    isGitRepo,
    ...(isGitRepo ? {} : { warning: 'Path is not a git repository; it will be initialized when saved.' }),
  };
}

export function isGitWorkTree(repoPath: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath, stdio: 'pipe' })
      .toString()
      .trim() === 'true';
  } catch {
    return false;
  }
}

// ─── Git URL parsing + cloning ──────────────────────────────────────

export interface ParsedRepoUrl {
  url: string;
  /** Filesystem-safe directory name derived from the repo URL. */
  name: string;
}

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;

function deriveRepoName(url: string): string | null {
  let s = url.trim().split(/[?#]/)[0];
  s = s.replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const segment = s.split(/[\\/:]/).filter(Boolean).pop() ?? '';
  const safe = segment.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe || safe === '.' || safe === '..') return null;
  return safe;
}

/**
 * Validate and parse a git repo URL. Accepts http(s)/ssh/git/file URLs, scp-like
 * refs (git@host:owner/repo.git) and absolute local paths (used for offline/dev
 * mirrors). Returns the parsed URL + a safe directory name, or an error string.
 */
export function parseGitRepoUrl(input: string): ParsedRepoUrl | string {
  const url = input.trim();
  if (!url) return 'repoUrl must be a non-empty string';
  if (url.length > 2048) return 'repoUrl is too long';
  if (CONTROL_CHARS_RE.test(url)) return 'repoUrl contains invalid control characters';
  if (url.startsWith('-')) return 'repoUrl must not start with "-"';

  const isUrlScheme = /^(https?|ssh|git|file):\/\//i.test(url);
  const isScpLike = !url.includes('://') && /^[^@/\\]+@[^:/\\]+:.+/.test(url);
  const isLocalAbs = path.isAbsolute(url);
  if (!isUrlScheme && !isScpLike && !isLocalAbs) {
    return 'repoUrl must be an http(s)/ssh/git/file URL, an scp-like ref, or an absolute local path';
  }

  const name = deriveRepoName(url);
  if (!name) return 'could not derive a repository name from repoUrl';
  return { url, name };
}

/** Normalize a git URL for equality comparison (case/slash/.git/trailing-slash insensitive). */
export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\\/g, '/').replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

/** Return the `origin` remote URL of a repo, or null if none/not a repo. */
export function getGitRemoteOrigin(repoPath: string): string | null {
  try {
    const out = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoPath, stdio: 'pipe' })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Clone `repoUrl` into `targetPath`. Uses execFileSync (no shell) and disables
 * interactive credential prompts so private repos without ambient credentials
 * fail fast instead of hanging.
 */
export function cloneRepo(repoUrl: string, targetPath: string, timeoutMs = 120_000): void {
  execFileSync('git', ['clone', '--', repoUrl, targetPath], {
    stdio: 'pipe',
    timeout: timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

export function expandTilde(p: string): string {
  if (!p.startsWith('~')) return p;
  const rest = p.slice(p.startsWith('~/') || p.startsWith('~\\') ? 2 : 1);
  return path.join(os.homedir(), rest);
}

export function normalizeRepoPathForCompare(repoPath: string): string {
  return normalizeForBoundaryCheck(realOrResolve(expandTilde(repoPath)));
}

// ─── Broadcast helpers ──────────────────────────────────────────────

export function broadcastTaskUpdate(task: Task): void {
  broadcast({ type: 'task_updated', payload: task });
}

export function broadcastGroupUpdate(group: TaskGroup): void {
  broadcast({ type: 'group_updated', payload: group });
}

export function broadcastProjectUpdate(project: Project): void {
  broadcast({ type: 'project_updated', payload: project });
}

export function broadcastProjectDelete(id: string): void {
  broadcast({ type: 'project_deleted', payload: { id } });
}

export async function failTaskWithEvent(
  repo: TaskRepository,
  task: Task,
  content: string,
): Promise<Task | undefined> {
  const event = {
    id: uuid(),
    taskId: task.id,
    type: 'error' as const,
    content,
    timestamp: Date.now(),
    metadata: {
      agentType: task.agentType,
      duration: 0,
      error: content,
    },
  };

  await repo.insertEvent(event);
  broadcast({ type: 'agent_event', payload: event });
  broadcast({
    type: 'agent_complete',
    payload: {
      taskId: task.id,
      status: 'failed',
      agentType: task.agentType,
      duration: 0,
      eventCount: 1,
    },
  });

  const failed = await repo.update(task.id, {
    agentStatus: 'failed',
    completedAt: event.timestamp,
  });
  if (failed) broadcastTaskUpdate(failed);
  return failed;
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
    return `invalid agentType: must be one of ${VALID_AGENT_TYPES.join(', ')}`;
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
  const { title, description, priority, columnId, agentType, repoPath, branchName, baseBranch, useWorktree, projectId } = body;
  return {
    id: uuid(),
    projectId: typeof projectId === 'string' && projectId ? projectId : 'default',
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

export function makeStatusCallback(
  repo: TaskRepository,
  taskId: string,
  agentManager?: AgentManager,
): (status: Task['agentStatus']) => void {
  return async (status) => {
    const statusUpdates: Partial<Task> = { agentStatus: status };
    if (status === 'complete') {
      statusUpdates.completedAt = Date.now();
      statusUpdates.columnId = 'review';
    }
    const t = await repo.update(taskId, statusUpdates);
    if (t) broadcastTaskUpdate(t);

    // On a successful completion, automatically open a PR for the task's branch
    // so the board can watch it through to merge (see PrWatcher). Best-effort and
    // gated inside the helper; failures leave the task in review with the manual
    // Create-PR button still available.
    if (status === 'complete' && t && agentManager) {
      await autoOpenPrOnComplete(repo, agentManager, t);
    }
  };
}

/** Persist + broadcast an informational/error event on a task's timeline. */
function emitTaskEvent(
  repo: TaskRepository,
  taskId: string,
  type: 'output' | 'error',
  content: string,
  agentType?: Task['agentType'],
): void {
  const event = {
    id: uuid(),
    taskId,
    type,
    content,
    timestamp: Date.now(),
    metadata: { phase: 'auto-pr', ...(agentType ? { agentType } : {}), ...(type === 'error' ? { error: content } : {}) },
  };
  void repo.insertEvent(event).catch((err: unknown) =>
    console.error('[auto-pr] failed to persist event:', errorMessage(err)),
  );
  broadcast({ type: 'agent_event', payload: event });
}

/** Maximum number of PR creation attempts before giving up and surfacing the error. */
const PR_CREATE_MAX_ATTEMPTS = 3;
/** Delays in ms between consecutive PR creation attempts (one per retry gap). */
const PR_CREATE_RETRY_DELAYS_MS = [2_000, 5_000] as const;

/**
 * Attempt to resolve merge conflicts by rebasing the task's branch on the base
 * and force-pushing. Emits a success or error event on the task timeline. This
 * is fire-and-forget — the PrWatcher will confirm whether the conflict cleared
 * on its next polling tick.
 */
async function attemptAutoConflictFix(
  repo: TaskRepository,
  agentManager: AgentManager,
  task: Task,
): Promise<void> {
  try {
    await agentManager.rebaseOnBase(task);
    emitTaskEvent(
      repo, task.id, 'output',
      `Automatically rebased ${task.branchName} on ${task.baseBranch || 'main'} to resolve merge conflicts. ` +
      'The pull request has been updated.',
      task.agentType,
    );
  } catch (err: unknown) {
    emitTaskEvent(
      repo, task.id, 'error',
      `Could not automatically resolve merge conflicts in ${task.branchName}: ${errorMessage(err)}\n` +
      'Manual conflict resolution is required before this PR can be merged.',
      task.agentType,
    );
  }
}

/**
 * Open a pull request for a freshly completed task and clean up its worktree,
 * mirroring POST /create-pr. Persists `prUrl` so {@link PrWatcher} can follow the
 * PR to its merge. No-ops (leaving the manual buttons in charge) when auto-PR is
 * disabled, the task is a group child, it already has a PR, or the repo has no
 * `origin` remote.
 *
 * Retries up to {@link PR_CREATE_MAX_ATTEMPTS} times with short delays to handle
 * transient network or push failures. After a successful creation the PR state is
 * immediately checked: conflicts trigger an automatic rebase, and CI failures emit
 * a visible warning so the developer knows to act before merging. Never throws.
 */
export async function autoOpenPrOnComplete(
  repo: TaskRepository,
  agentManager: AgentManager,
  task: Task,
): Promise<void> {
  if (getConfig().autoPrEnabled === false) return;
  if (task.groupId) return;                    // group children roll up to the group
  if (task.prUrl) return;                      // already has a PR
  if (!task.branchName || !task.repoPath) return;
  if (!agentManager.hasRemote(task)) return;   // local-only repo → keep manual flow

  let lastError: string | null = null;

  for (let attempt = 0; attempt < PR_CREATE_MAX_ATTEMPTS; attempt++) {
    // Wait before retry (not on the first attempt)
    if (attempt > 0) {
      const delay = PR_CREATE_RETRY_DELAYS_MS[attempt - 1] ?? 5_000;
      emitTaskEvent(
        repo, task.id, 'output',
        `Retrying PR creation (attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS})…`,
        task.agentType,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }

    try {
      const { url } = agentManager.createPR(task);
      const updates: Partial<Task> = { prUrl: url };
      // The branch is pushed; the worktree directory is no longer needed.
      if (task.worktreePath) {
        try { agentManager.removeWorktree(task); } catch { /* best effort */ }
        updates.worktreePath = undefined;
      }
      const updated = await repo.update(task.id, updates);
      if (updated) broadcastTaskUpdate(updated);

      // Inspect the newly-created PR's initial state so we can warn early.
      const liveTask = { ...(updated ?? task), prUrl: url };
      const details = agentManager.getPRDetails(liveTask);
      let notice = '';
      if (details !== null && details.mergeable === 'CONFLICTING') {
        notice = '\n⚠️  This PR has merge conflicts. Attempting to rebase and fix automatically…';
        void attemptAutoConflictFix(repo, agentManager, liveTask);
      } else if (details !== null && details.ciPassed === false) {
        const failCount = details.checkConclusions.filter(
          (s) => ['FAILURE', 'ERROR', 'CANCELLED', 'ACTION_REQUIRED', 'TIMED_OUT'].includes(s),
        ).length;
        notice = `\n⚠️  ${failCount > 0 ? `${failCount} CI check(s) are` : 'CI checks are'} failing. ` +
          'Review and fix the failures before merging.';
      }

      emitTaskEvent(
        repo, task.id, 'output',
        `Opened pull request for ${task.branchName}: ${url}\n` +
        'Watching for merge — the task will move to Done and its branch/worktree will be cleaned up automatically once the PR is merged.' +
        notice,
        task.agentType,
      );
      return; // success — stop retrying
    } catch (err: unknown) {
      lastError = errorMessage(err);
      if (attempt < PR_CREATE_MAX_ATTEMPTS - 1) {
        emitTaskEvent(
          repo, task.id, 'output',
          `PR creation attempt ${attempt + 1} failed: ${lastError}`,
          task.agentType,
        );
      }
    }
  }

  // All attempts exhausted — surface the final error
  emitTaskEvent(
    repo, task.id, 'error',
    `Automatic PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts: ${lastError}\n` +
    'Use the Create PR button to open it manually.',
    task.agentType,
  );
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
    agentManager.startAgent(updated, makeStatusCallback(repo, task.id, agentManager), makeWorktreeCallback(repo, task.id));
  }
}
