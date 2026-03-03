import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { TaskTemplate } from '../types.js';
import { isValidPriority, isValidAgentType, MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH } from '@agentic-kanban/shared/constants.js';
import type { TemplateRepository } from '../repositories/template-types.js';
import { paramId } from './helpers.js';

const MAX_TEMPLATE_NAME_LENGTH = 100;

export function createTemplateRouter(templateRepo: TemplateRepository): Router {
  const router = Router();

  // GET /api/templates
  router.get('/', async (_req: Request, res: Response) => {
    res.json(await templateRepo.getAll());
  });

  // GET /api/templates/:id
  router.get('/:id', async (req: Request, res: Response) => {
    const template = await templateRepo.getById(paramId(req));
    if (!template) {
      res.status(404).json({ error: 'template not found' });
      return;
    }
    res.json(template);
  });

  // POST /api/templates
  router.post('/', async (req: Request, res: Response) => {
    const { name, title, description, priority, agentType, repoPath, baseBranch, useWorktree } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
      res.status(400).json({ error: `name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters` });
      return;
    }
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
      res.status(400).json({ error: 'invalid priority' });
      return;
    }
    if (agentType !== undefined && !isValidAgentType(agentType)) {
      res.status(400).json({ error: 'invalid agentType' });
      return;
    }

    const template: TaskTemplate = {
      id: uuid(),
      name: name.trim(),
      title: (title || '').trim(),
      description: (description || '').trim(),
      priority: priority || 'medium',
      agentType: agentType || 'copilot',
      repoPath: repoPath || undefined,
      baseBranch: baseBranch || undefined,
      useWorktree: useWorktree ?? undefined,
      createdAt: Date.now(),
    };

    try {
      const created = await templateRepo.create(template);
      res.status(201).json(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.includes('unique') || msg.includes('duplicate')) {
        res.status(409).json({ error: 'a template with that name already exists' });
      } else {
        res.status(500).json({ error: 'failed to create template' });
      }
    }
  });

  // PATCH /api/templates/:id
  router.patch('/:id', async (req: Request, res: Response) => {
    const existing = await templateRepo.getById(paramId(req));
    if (!existing) {
      res.status(404).json({ error: 'template not found' });
      return;
    }

    const { name, title, description, priority, agentType, repoPath, baseBranch, useWorktree } = req.body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ error: 'name must be a non-empty string' });
      return;
    }
    if (typeof name === 'string' && name.length > MAX_TEMPLATE_NAME_LENGTH) {
      res.status(400).json({ error: `name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters` });
      return;
    }
    if (priority !== undefined && !isValidPriority(priority)) {
      res.status(400).json({ error: 'invalid priority' });
      return;
    }
    if (agentType !== undefined && !isValidAgentType(agentType)) {
      res.status(400).json({ error: 'invalid agentType' });
      return;
    }
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

    const updates: Partial<Omit<TaskTemplate, 'id' | 'createdAt'>> = {};
    if (name !== undefined) updates.name = name.trim();
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (priority !== undefined) updates.priority = priority;
    if (agentType !== undefined) updates.agentType = agentType;
    if (repoPath !== undefined) updates.repoPath = repoPath;
    if (baseBranch !== undefined) updates.baseBranch = baseBranch;
    if (useWorktree !== undefined) updates.useWorktree = useWorktree;

    try {
      const updated = await templateRepo.update(paramId(req), updates);
      if (!updated) {
        res.status(500).json({ error: 'failed to update template' });
        return;
      }
      res.json(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.includes('unique') || msg.includes('duplicate')) {
        res.status(409).json({ error: 'a template with that name already exists' });
      } else {
        res.status(500).json({ error: 'failed to update template' });
      }
    }
  });

  // DELETE /api/templates/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    const deleted = await templateRepo.delete(paramId(req));
    if (!deleted) {
      res.status(404).json({ error: 'template not found' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
