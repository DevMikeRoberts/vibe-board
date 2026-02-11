import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import os from 'os';
import path from 'path';
import type { Task } from '../types.js';
import { VALID_TRANSITIONS, isValidPriority, isValidColumnId, isValidAgentStatus, isValidAgentType } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import { broadcast } from '../websocket.js';
import type { AgentManager } from '../services/agent-manager.js';

function paramId(req: Request): string {
  const id = req.params.id;
  return typeof id === 'string' ? id : id[0];
}

// Reject branch names with shell metacharacters or git-invalid patterns
const GIT_REF_RE = /^[a-zA-Z0-9_/][a-zA-Z0-9_./-]*$/;
function isValidGitRef(ref: string): boolean {
  return GIT_REF_RE.test(ref) && !ref.includes('..') && !ref.endsWith('.lock') && ref.length <= 200;
}

// Allowed repo root directories — prevents path traversal to /etc, /root/.ssh, etc.
const ALLOWED_REPO_ROOTS = (process.env.ALLOWED_REPO_ROOTS || `${os.homedir()},/tmp`)
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

function isAllowedRepoPath(repoPath: string): string | null {
  const resolved = path.resolve(repoPath);
  // Must be under one of the allowed roots
  const underAllowedRoot = ALLOWED_REPO_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
  if (!underAllowedRoot) {
    return `repoPath must be under one of: ${ALLOWED_REPO_ROOTS.join(', ')}`;
  }
  return null;
}

function expandTilde(p: string): string {
  if (!p.startsWith('~')) return p;
  const rest = p.slice(p.startsWith('~/') || p.startsWith('~\\') ? 2 : 1);
  return path.join(os.homedir(), rest);
}

function broadcastTaskUpdate(task: Task): void {
  broadcast({ type: 'task_updated', payload: task });
}

// Simple per-task rate limiter for agent run/stop (1 request per 5 seconds per task)
const RATE_LIMIT_MS = 5_000;
const agentActionTimestamps = new Map<string, number>();

function isRateLimited(taskId: string): boolean {
  const now = Date.now();
  // Always evict stale entries to prevent unbounded growth
  for (const [id, ts] of agentActionTimestamps) {
    if (now - ts > RATE_LIMIT_MS) agentActionTimestamps.delete(id);
  }
  const last = agentActionTimestamps.get(taskId);
  if (last && now - last < RATE_LIMIT_MS) return true;
  agentActionTimestamps.set(taskId, now);
  return false;
}

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;

// NOTE: This is a local-only demo app — no authentication is applied to these
// routes. If deploying beyond localhost, add authentication middleware here.
export function createTaskRouter(repo: TaskRepository, agentManager: AgentManager): Router {
  const router = Router();

  // GET /api/tasks
  router.get('/', (_req: Request, res: Response) => {
    res.json(repo.getAll());
  });

  // Shared validation for task creation fields — returns error string or null
  function validateTaskFields(body: Record<string, any>): string | null {
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
      return 'invalid agentType: must be one of copilot, claude, codex';
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
    if (typeof branchName === 'string' && !isValidGitRef(branchName)) {
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

  // Build a Task object from validated request body
  function buildTask(body: Record<string, any>): Task {
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
      useWorktree: useWorktree || undefined,
    };
  }

  // Start an agent for a task (shared by create+autoRun and batch)
  function startAgentForTask(task: Task): void {
    const updates: Partial<Task> = {
      agentStatus: 'planning',
      startedAt: Date.now(),
      completedAt: undefined,
    };
    if (task.columnId === 'backlog') {
      updates.columnId = 'in-progress';
    }
    const updated = repo.update(task.id, updates);
    if (updated) {
      broadcastTaskUpdate(updated);
      agentManager.startAgent(
        updated,
        (status) => {
          const statusUpdates: Partial<Task> = { agentStatus: status };
          if (status === 'complete') {
            statusUpdates.completedAt = Date.now();
            statusUpdates.columnId = 'review';
          }
          const t = repo.update(task.id, statusUpdates);
          if (t) broadcastTaskUpdate(t);
        },
        (worktreePath) => {
          const t = repo.update(task.id, { worktreePath });
          if (t) broadcastTaskUpdate(t);
        }
      );
    }
  }

  // POST /api/tasks
  router.post('/', (req: Request, res: Response) => {
    const validationError = validateTaskFields(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const task = buildTask(req.body);
    repo.create(task);
    broadcastTaskUpdate(task);

    const { autoRun } = req.body;

    // autoRun: true — immediately start agent if columnId is in-progress
    if (autoRun === true && task.columnId === 'in-progress') {
      // Validate agent is available before auto-running
      const agents = agentManager.getAvailableAgents();
      const agentInfo = agents.find(a => a.name === task.agentType);
      if (!agentInfo?.available) {
        // Create task but mark as failed
        const failed = repo.update(task.id, { agentStatus: 'failed' });
        if (failed) broadcastTaskUpdate(failed);
        res.status(201).json(failed || { ...task, agentStatus: 'failed' });
        return;
      }
      startAgentForTask(task);
      // Re-fetch the task to get updated status
      const latest = repo.getById(task.id);
      res.status(201).json(latest || task);
      return;
    }

    res.status(201).json(task);
  });

  // POST /api/tasks/batch — create multiple tasks, optionally auto-run them
  router.post('/batch', (req: Request, res: Response) => {
    const { tasks: taskDefs } = req.body;

    if (!Array.isArray(taskDefs) || taskDefs.length === 0) {
      res.status(400).json({ error: 'tasks must be a non-empty array' });
      return;
    }

    if (taskDefs.length > 50) {
      res.status(400).json({ error: 'batch limit is 50 tasks' });
      return;
    }

    // Validate ALL tasks first (atomic — fail fast)
    for (let i = 0; i < taskDefs.length; i++) {
      const err = validateTaskFields(taskDefs[i]);
      if (err) {
        res.status(400).json({ error: `task[${i}]: ${err}` });
        return;
      }
    }

    // Create all tasks
    const created: Task[] = [];
    for (const def of taskDefs) {
      const task = buildTask(def);
      repo.create(task);
      broadcastTaskUpdate(task);
      created.push(task);
    }

    // Auto-run tasks that requested it
    for (let i = 0; i < created.length; i++) {
      const task = created[i];
      const def = taskDefs[i];
      if (def.autoRun === true && task.columnId === 'in-progress') {
        const agents = agentManager.getAvailableAgents();
        const agentInfo = agents.find(a => a.name === task.agentType);
        if (!agentInfo?.available) {
          const failed = repo.update(task.id, { agentStatus: 'failed' });
          if (failed) {
            broadcastTaskUpdate(failed);
            created[i] = failed;
          }
        } else {
          startAgentForTask(task);
          const latest = repo.getById(task.id);
          if (latest) created[i] = latest;
        }
      }
    }

    res.status(201).json({ tasks: created });
  });

  // GET /api/tasks/:id/status — lightweight polling endpoint
  router.get('/:id/status', (req: Request, res: Response) => {
    const task = repo.getById(paramId(req));
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.json({
      id: task.id,
      agentStatus: task.agentStatus,
      agentType: task.agentType,
      columnId: task.columnId,
      isRunning: agentManager.isRunning(task.id),
    });
  });

  // PATCH /api/tasks/:id
  router.patch('/:id', (req: Request, res: Response) => {
    const task = repo.getById(paramId(req));
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const { title, description, priority, columnId, agentStatus, agentType, repoPath } = req.body;

    // Validate types of all incoming fields
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      res.status(400).json({ error: 'title must be a non-empty string' });
      return;
    }
    if (typeof title === 'string' && title.length > MAX_TITLE_LENGTH) {
      res.status(400).json({ error: `title must be at most ${MAX_TITLE_LENGTH} characters` });
      return;
    }
    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' });
      return;
    }
    if (typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
      res.status(400).json({ error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
      return;
    }
    if (priority !== undefined && !isValidPriority(priority)) {
      res.status(400).json({ error: 'invalid priority: must be one of low, medium, high, critical' });
      return;
    }
    if (columnId !== undefined && !isValidColumnId(columnId)) {
      res.status(400).json({ error: 'invalid columnId: must be one of backlog, in-progress, review, done' });
      return;
    }
    if (agentStatus !== undefined && !isValidAgentStatus(agentStatus)) {
      res.status(400).json({ error: 'invalid agentStatus: must be one of idle, planning, executing, complete, failed' });
      return;
    }
    if (agentType !== undefined && !isValidAgentType(agentType)) {
      res.status(400).json({ error: 'invalid agentType: must be one of copilot, claude, codex' });
      return;
    }
    if (repoPath !== undefined && typeof repoPath !== 'string') {
      res.status(400).json({ error: 'repoPath must be a string' });
      return;
    }

    // Validate column transition if columnId is changing
    if (columnId && columnId !== task.columnId) {
      const allowed = VALID_TRANSITIONS[task.columnId];
      if (!allowed.includes(columnId)) {
        res.status(400).json({ error: `Cannot move from ${task.columnId} to ${columnId}` });
        return;
      }
    }

    // Build updates from validated fields
    const updates: Partial<Task> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (priority !== undefined) updates.priority = priority;
    if (columnId !== undefined) updates.columnId = columnId;
    if (agentStatus !== undefined) updates.agentStatus = agentStatus;
    if (agentType !== undefined) updates.agentType = agentType;
    if (repoPath !== undefined) updates.repoPath = repoPath;

    // Reset agent state when moved to in-progress
    if (columnId === 'in-progress') {
      updates.agentStatus = 'idle';
      updates.startedAt = undefined;
      updates.completedAt = undefined;
    }

    const updated = repo.update(task.id, updates);
    if (!updated) {
      res.status(500).json({ error: 'failed to update task' });
      return;
    }
    broadcastTaskUpdate(updated);
    res.json(updated);
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', (req: Request, res: Response) => {
    const id = paramId(req);
    if (!repo.getById(id)) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    agentManager.stopAgent(id);
    agentManager.clearEvents(id);
    repo.delete(id);
    broadcast({ type: 'task_deleted', payload: { id } });
    res.status(204).send();
  });

  // POST /api/tasks/:id/configure — store worktree config before running
  router.post('/:id/configure', (req: Request, res: Response) => {
    const id = paramId(req);
    const task = repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const { repoPath, branchName, baseBranch, useWorktree, agentType } = req.body;

    if (repoPath !== undefined && typeof repoPath !== 'string') {
      res.status(400).json({ error: 'repoPath must be a string' });
      return;
    }
    if (branchName !== undefined && typeof branchName !== 'string') {
      res.status(400).json({ error: 'branchName must be a string' });
      return;
    }
    if (baseBranch !== undefined && typeof baseBranch !== 'string') {
      res.status(400).json({ error: 'baseBranch must be a string' });
      return;
    }
    if (useWorktree !== undefined && typeof useWorktree !== 'boolean') {
      res.status(400).json({ error: 'useWorktree must be a boolean' });
      return;
    }
    if (agentType !== undefined && !isValidAgentType(agentType)) {
      res.status(400).json({ error: 'invalid agentType: must be one of copilot, claude, codex' });
      return;
    }
    if (typeof branchName === 'string' && !isValidGitRef(branchName)) {
      res.status(400).json({ error: 'branchName contains invalid characters' });
      return;
    }
    if (typeof baseBranch === 'string' && !isValidGitRef(baseBranch)) {
      res.status(400).json({ error: 'baseBranch contains invalid characters' });
      return;
    }
    if (typeof repoPath === 'string') {
      const expandedRepoPath = expandTilde(repoPath);
      if (!path.isAbsolute(expandedRepoPath)) {
        res.status(400).json({ error: 'repoPath must be an absolute path (e.g. ~/projects/my-app or C:\\Users\\you\\projects\\my-app)' });
        return;
      }
      const repoErr = isAllowedRepoPath(expandedRepoPath);
      if (repoErr) {
        res.status(400).json({ error: repoErr });
        return;
      }
    }

    const updates: Partial<Task> = {};
    if (repoPath !== undefined) updates.repoPath = typeof repoPath === 'string' ? expandTilde(repoPath) : repoPath;
    if (branchName !== undefined) updates.branchName = branchName;
    if (baseBranch !== undefined) updates.baseBranch = baseBranch;
    if (useWorktree !== undefined) updates.useWorktree = useWorktree;
    if (agentType !== undefined) updates.agentType = agentType;

    const updated = repo.update(id, updates);
    if (!updated) {
      res.status(500).json({ error: 'failed to update task' });
      return;
    }
    broadcastTaskUpdate(updated);
    res.json(updated);
  });

  // POST /api/tasks/:id/run
  router.post('/:id/run', (req: Request, res: Response) => {
    const id = paramId(req);
    if (isRateLimited(id)) {
      res.status(429).json({ error: 'too many requests, try again shortly' });
      return;
    }
    const task = repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (agentManager.isRunning(task.id)) {
      res.status(409).json({ error: 'agent already running for this task' });
      return;
    }

    const updates: Partial<Task> = {
      agentStatus: 'planning',
      startedAt: Date.now(),
      completedAt: undefined,
    };
    if (task.columnId === 'backlog') {
      updates.columnId = 'in-progress';
    }
    const updated = repo.update(task.id, updates);
    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    broadcastTaskUpdate(updated);

    agentManager.startAgent(
      updated,
      (status) => {
        const statusUpdates: Partial<Task> = { agentStatus: status };
        if (status === 'complete') {
          statusUpdates.completedAt = Date.now();
          statusUpdates.columnId = 'review';
        }
        const t = repo.update(task.id, statusUpdates);
        if (t) broadcastTaskUpdate(t);
      },
      (worktreePath) => {
        const t = repo.update(task.id, { worktreePath });
        if (t) broadcastTaskUpdate(t);
      }
    );

    res.json(updated);
  });

  // POST /api/tasks/:id/stop
  router.post('/:id/stop', (req: Request, res: Response) => {
    const id = paramId(req);
    if (isRateLimited(id)) {
      res.status(429).json({ error: 'too many requests, try again shortly' });
      return;
    }
    const task = repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const stopped = agentManager.stopAgent(task.id);
    if (!stopped) {
      res.status(409).json({ error: 'no running agent for this task' });
      return;
    }
    const updated = repo.update(task.id, { agentStatus: 'failed' });
    if (!updated) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    broadcastTaskUpdate(updated);
    res.json(updated);
  });

  // POST /api/tasks/:id/message — send a follow-up message to a running agent
  router.post('/:id/message', async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required and must be a non-empty string' });
      return;
    }

    if (!agentManager.isRunning(task.id)) {
      res.status(409).json({ error: 'no running agent for this task' });
      return;
    }

    try {
      await agentManager.sendMessage(task.id, message);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'failed to send message' });
    }
  });

  // GET /api/tasks/:id/events
  router.get('/:id/events', (req: Request, res: Response) => {
    if (!repo.getById(paramId(req))) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.json(agentManager.getEvents(paramId(req)));
  });

  // POST /api/tasks/:id/create-pr — create a PR from the worktree branch
  router.post('/:id/create-pr', (req: Request, res: Response) => {
    const id = paramId(req);
    const task = repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.branchName || !task.repoPath) {
      res.status(400).json({ error: 'task has no branch or repo configured' });
      return;
    }
    try {
      const result = agentManager.createPR(task);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tasks/:id/cleanup-worktree — remove worktree after done
  router.post('/:id/cleanup-worktree', (req: Request, res: Response) => {
    const id = paramId(req);
    const task = repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.worktreePath) {
      res.status(400).json({ error: 'no worktree to clean up' });
      return;
    }
    try {
      agentManager.removeWorktree(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
    const updated = repo.update(id, { worktreePath: undefined });
    if (updated) broadcastTaskUpdate(updated);
    res.json({ success: true });
  });

  return router;
}
