import { Router, Request, Response } from 'express';
import path from 'path';
import type { Task } from '../types.js';
import { VALID_TRANSITIONS } from '../types.js';
import { isValidPriority, isValidColumnId, isValidAgentStatus, isValidAgentType, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '@copilot-kanban/shared/constants.js';
import type { TaskRepository } from '../repositories/types.js';
import { broadcast } from '../websocket.js';
import type { AgentManager } from '../services/agent-manager.js';
import {
  paramId, isAllowedRepoPath, expandTilde,
  validateTaskFields, buildTask, broadcastTaskUpdate,
  startAgentForTask,
} from './helpers.js';

export function createTaskRouter(repo: TaskRepository, agentManager: AgentManager): Router {
  const router = Router();

  // GET /api/tasks
  router.get('/', async (req: Request, res: Response) => {
    const includeArchived = req.query.includeArchived === 'true';
    res.json(await repo.getAll(includeArchived));
  });

  // GET /api/tasks/archived
  router.get('/archived', async (_req: Request, res: Response) => {
    res.json(await repo.getArchivedTasks());
  });

  // POST /api/tasks
  router.post('/', async (req: Request, res: Response) => {
    const validationError = validateTaskFields(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const task = buildTask(req.body);
    await repo.create(task);
    broadcastTaskUpdate(task);

    const { autoRun } = req.body;

    // autoRun: true — immediately start agent if columnId is in-progress
    if (autoRun === true && task.columnId === 'in-progress') {
      const agents = agentManager.getAvailableAgents();
      const agentInfo = agents.find(a => a.name === task.agentType);
      if (!agentInfo?.available) {
        const failed = await repo.update(task.id, { agentStatus: 'failed' });
        if (failed) broadcastTaskUpdate(failed);
        res.status(201).json(failed || { ...task, agentStatus: 'failed' });
        return;
      }
      await startAgentForTask(task, repo, agentManager);
      const latest = await repo.getById(task.id);
      res.status(201).json(latest || task);
      return;
    }

    res.status(201).json(task);
  });

  // POST /api/tasks/batch — create multiple tasks, optionally auto-run them
  router.post('/batch', async (req: Request, res: Response) => {
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
      await repo.create(task);
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
          const failed = await repo.update(task.id, { agentStatus: 'failed' });
          if (failed) {
            broadcastTaskUpdate(failed);
            created[i] = failed;
          }
        } else {
          await startAgentForTask(task, repo, agentManager);
          const latest = await repo.getById(task.id);
          if (latest) created[i] = latest;
        }
      }
    }

    res.status(201).json({ tasks: created });
  });

  // GET /api/tasks/:id/status — lightweight polling endpoint
  router.get('/:id/status', async (req: Request, res: Response) => {
    const task = await repo.getById(paramId(req));
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
  router.patch('/:id', async (req: Request, res: Response) => {
    const task = await repo.getById(paramId(req));
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const { title, description, priority, columnId, agentStatus, agentType, repoPath, archived } = req.body;

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
    if (typeof repoPath === 'string') {
      const expandedRepoPath = expandTilde(repoPath);
      if (!path.isAbsolute(expandedRepoPath)) {
        res.status(400).json({ error: 'repoPath must be an absolute path' });
        return;
      }
      const repoErr = isAllowedRepoPath(expandedRepoPath);
      if (repoErr) {
        res.status(400).json({ error: repoErr });
        return;
      }
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
    if (repoPath !== undefined) updates.repoPath = typeof repoPath === 'string' ? expandTilde(repoPath) : repoPath;
    if (archived !== undefined) updates.archived = Boolean(archived);

    // Reset agent state when moved to in-progress
    if (columnId === 'in-progress') {
      updates.agentStatus = 'idle';
      updates.startedAt = undefined;
      updates.completedAt = undefined;
    }

    const updated = await repo.update(task.id, updates);
    if (!updated) {
      res.status(500).json({ error: 'failed to update task' });
      return;
    }
    broadcastTaskUpdate(updated);
    res.json(updated);
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!await repo.getById(id)) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    agentManager.stopAgent(id);
    agentManager.clearEvents(id);
    await repo.deleteEventsByTaskId(id);
    await repo.delete(id);
    broadcast({ type: 'task_deleted', payload: { id } });
    res.status(204).send();
  });

  // PATCH /api/tasks/:id/archive
  router.patch('/:id/archive', async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (task.columnId !== 'done' && task.agentStatus !== 'failed') {
      res.status(400).json({ error: 'can only archive completed or failed tasks' });
      return;
    }
    const updated = await repo.update(id, { archived: true });
    if (!updated) {
      res.status(500).json({ error: 'failed to archive task' });
      return;
    }
    broadcastTaskUpdate(updated);
    res.json(updated);
  });

  // PATCH /api/tasks/:id/unarchive
  router.patch('/:id/unarchive', async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.archived) {
      res.status(400).json({ error: 'task is not archived' });
      return;
    }
    const updated = await repo.update(id, { archived: false });
    if (!updated) {
      res.status(500).json({ error: 'failed to unarchive task' });
      return;
    }
    broadcastTaskUpdate(updated);
    res.json(updated);
  });

  return router;
}
