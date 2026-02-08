import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Task } from '../types.js';
import { VALID_TRANSITIONS, isValidPriority, isValidColumnId, isValidAgentStatus } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import { broadcast } from '../websocket.js';
import { startAgent, stopAgent, getEvents, clearEvents, isRunning } from '../services/copilot.js';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

function broadcastTaskUpdate(task: Task): void {
  broadcast({ type: 'task_updated', payload: task });
}

// Simple per-task rate limiter for agent run/stop (1 request per 5 seconds per task)
const RATE_LIMIT_MS = 5_000;
const agentActionTimestamps = new Map<string, number>();

function isRateLimited(taskId: string): boolean {
  const now = Date.now();
  // Evict stale entries periodically (when map exceeds 200 entries)
  if (agentActionTimestamps.size > 200) {
    for (const [id, ts] of agentActionTimestamps) {
      if (now - ts > RATE_LIMIT_MS) agentActionTimestamps.delete(id);
    }
  }
  const last = agentActionTimestamps.get(taskId);
  if (last && now - last < RATE_LIMIT_MS) return true;
  agentActionTimestamps.set(taskId, now);
  return false;
}

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;

export function createTaskRouter(repo: TaskRepository): Router {
  const router = Router();

  // GET /api/tasks
  router.get('/', (_req: Request, res: Response) => {
    res.json(repo.getAll());
  });

  // POST /api/tasks
  router.post('/', (req: Request, res: Response) => {
    const { title, description, priority, columnId } = req.body;

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required and must be a string' });
      return;
    }
    if (title.length > MAX_TITLE_LENGTH) {
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
      res.status(400).json({ error: `invalid priority: must be one of low, medium, high, critical` });
      return;
    }
    if (columnId !== undefined && !isValidColumnId(columnId)) {
      res.status(400).json({ error: `invalid columnId: must be one of backlog, in-progress, review, done` });
      return;
    }

    const task: Task = {
      id: uuid(),
      title,
      description: description || '',
      priority: priority || 'medium',
      columnId: columnId || 'backlog',
      agentStatus: 'idle',
      createdAt: Date.now(),
    };
    repo.create(task);
    broadcastTaskUpdate(task);
    res.status(201).json(task);
  });

  // PATCH /api/tasks/:id
  router.patch('/:id', (req: Request, res: Response) => {
    const task = repo.getById(paramId(req));
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const { title, description, priority, columnId, agentStatus } = req.body;

    // Validate types of all incoming fields
    if (title !== undefined && typeof title !== 'string') {
      res.status(400).json({ error: 'title must be a string' });
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

    // Validate column transition if columnId is changing
    if (columnId && columnId !== task.columnId) {
      const allowed = VALID_TRANSITIONS[task.columnId];
      if (!allowed.includes(columnId)) {
        res.status(400).json({ error: `Cannot move from ${task.columnId} to ${columnId}` });
        return;
      }
    }

    // Build updates from validated fields (no `as any` needed)
    const updates: Partial<Task> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (priority !== undefined) updates.priority = priority;
    if (columnId !== undefined) updates.columnId = columnId;
    if (agentStatus !== undefined) updates.agentStatus = agentStatus;

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
    if (!repo.delete(id)) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    clearEvents(id);
    res.status(204).send();
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
    if (isRunning(task.id)) {
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

    startAgent(updated, (status) => {
      const statusUpdates: Partial<Task> = { agentStatus: status };
      if (status === 'complete') {
        statusUpdates.completedAt = Date.now();
        statusUpdates.columnId = 'review';
      }
      const t = repo.update(task.id, statusUpdates);
      if (t) broadcastTaskUpdate(t);
    });

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
    const stopped = stopAgent(task.id);
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

  // GET /api/tasks/:id/events
  router.get('/:id/events', (req: Request, res: Response) => {
    if (!repo.getById(paramId(req))) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.json(getEvents(paramId(req)));
  });

  return router;
}
