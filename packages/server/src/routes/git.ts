import { Router, Request, Response } from 'express';
import type { TaskRepository } from '../repositories/types.js';
import type { AgentManager } from '../services/agent-manager.js';
import { paramId, broadcastTaskUpdate } from './helpers.js';

export function createGitRouter(repo: TaskRepository, agentManager: AgentManager): Router {
  const router = Router();

  // POST /api/tasks/:id/create-pr — create a PR from the worktree branch
  router.post('/:id/create-pr', async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
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
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create PR' });
    }
  });

  // POST /api/tasks/:id/cleanup-worktree — remove worktree after done
  router.post('/:id/cleanup-worktree', async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
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
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to cleanup worktree' });
      return;
    }
    const updated = await repo.update(id, { worktreePath: undefined });
    if (updated) broadcastTaskUpdate(updated);
    res.json({ success: true });
  });

  // POST /api/tasks/:id/merge-local — merge worktree branch into base branch locally
  router.post('/:id/merge-local', async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    if (!task.branchName || !task.repoPath) {
      res.status(400).json({ error: 'task has no branch or repo configured' });
      return;
    }
    try {
      const result = agentManager.mergeLocal(task);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to merge' });
    }
  });

  return router;
}
