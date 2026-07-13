import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import type { TaskRepository } from '../repositories/types.js';
import type { AgentManager } from '../services/agent-manager.js';
import { asyncHandler, paramId } from './helpers.js';

export function createGitRouter(repo: TaskRepository, agentManager: AgentManager): Router {
  const router = Router();

  // GET /api/tasks/:id/git-info — check if repo has a remote
  router.get('/:id/git-info', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    const task = await repo.getById(id);
    if (!task) { res.status(404).json({ error: 'task not found' }); return; }
    if (!task.repoPath) { res.json({ hasRemote: false }); return; }

    try {
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: task.repoPath, stdio: 'pipe',
      }).toString().trim();
      res.json({ hasRemote: !!remote });
    } catch {
      res.json({ hasRemote: false });
    }
  }));

  // POST /api/tasks/:id/create-pr — create a PR from the task's branch
  router.post('/:id/create-pr', asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // POST /api/tasks/:id/merge-local — merge task branch into base branch locally
  router.post('/:id/merge-local', asyncHandler(async (req: Request, res: Response) => {
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
      const result = await agentManager.mergeLocal(task);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to merge' });
    }
  }));

  return router;
}
