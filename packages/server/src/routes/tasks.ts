import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Task, ColumnId, Priority } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import { broadcast } from '../websocket.js';
import { startAgent, stopAgent, getEvents, isRunning } from '../services/copilot.js';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

function broadcastTaskUpdate(task: Task): void {
  broadcast({ type: 'task_updated', payload: task });
}

// Valid column transitions
const validTransitions: Record<ColumnId, ColumnId[]> = {
  'backlog': ['in-progress'],
  'in-progress': ['review'],
  'review': ['done', 'in-progress'],
  'done': [],
};

export function createTaskRouter(repo: TaskRepository): Router {
  const router = Router();

  // GET /api/tasks
  router.get('/', (_req: Request, res: Response) => {
    res.json(repo.getAll());
  });

  // POST /api/tasks
  router.post('/', (req: Request, res: Response) => {
    const { title, description, priority, columnId } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const task: Task = {
      id: uuid(),
      title,
      description: description || '',
      priority: (priority as Priority) || 'medium',
      columnId: (columnId as ColumnId) || 'backlog',
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

    // Validate column transition if columnId is changing
    const newColumnId = req.body.columnId as ColumnId | undefined;
    if (newColumnId && newColumnId !== task.columnId) {
      const allowed = validTransitions[task.columnId];
      if (!allowed.includes(newColumnId)) {
        res.status(400).json({ error: `Cannot move from ${task.columnId} to ${newColumnId}` });
        return;
      }
    }

    const updates: Partial<Task> = {};
    const allowedFields = ['title', 'description', 'priority', 'columnId', 'agentStatus'] as const;
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        (updates as any)[key] = req.body[key];
      }
    }

    // Reset agent state when moved to in-progress
    if (newColumnId === 'in-progress') {
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
    if (!repo.delete(paramId(req))) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.status(204).send();
  });

  // POST /api/tasks/:id/run
  router.post('/:id/run', (req: Request, res: Response) => {
    const task = repo.getById(paramId(req));
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
    const updated = repo.update(task.id, updates)!;
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
    const task = repo.getById(paramId(req));
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    const stopped = stopAgent(task.id);
    if (!stopped) {
      res.status(409).json({ error: 'no running agent for this task' });
      return;
    }
    const updated = repo.update(task.id, { agentStatus: 'failed' })!;
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
