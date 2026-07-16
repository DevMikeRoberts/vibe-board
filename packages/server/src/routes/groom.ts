import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Task } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { ProjectRepository } from '../repositories/project-types.js';
import { broadcast } from '../websocket.js';
import type { AgentManager } from '../services/agent-manager.js';
import { asyncHandler, makeStatusCallback } from './helpers.js';

const GROOM_PROJECT_ID = '__backlog_groom__';
const GROOMER_AGENT: Task['agentType'] = 'opencode';
const MAX_BACKLOG_FOR_GROOM = 50;

function buildSystemPrompt(opts: {
  projectId: string;
  tasks: Task[];
}): string {
  const { projectId, tasks } = opts;

  const tasksJSON = tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    agentType: t.agentType,
    repoPath: t.repoPath,
  }));

  return `You are a backlog groomer for an AI Kanban board. Your job is to improve ${tasks.length} backlog task(s) so AI coding agents can pick them up and implement them efficiently.

## Project ID
${projectId}

## Backlog Tasks
${JSON.stringify(tasksJSON, null, 2)}

## Your Task
For each task above, output a grooming update. Be token-conscious:
- **Title** — short (<80 chars), action-oriented, describes what the agent should do
- **Description** — clear goal, context (1-2 sentences), acceptance criteria (bullet list). Stay under 2000 chars total.
- **agentType** — pick the best agent for the task (copilot/claude/codex/opencode/hermes/openclaw)
- **Skills** — suggest which built-in skills to load (e.g. repo-scan for unfamiliar repos)
- **Search** — suggest search queries the agent should run first (e.g. find relevant files)
- **Assets** — if the task needs reference files/screenshots, note what to attach
- **MCP** — if a Model Context Protocol server would help (e.g. serena for browser testing), note it

## Rules
1. Keep titles under 80 chars — agents scan them first
2. Descriptions: 1-2 sentence goal, then 2-5 acceptance criteria bullets
3. Prefer \`opencode\` as agentType unless task clearly needs another agent's strength (claude for deep analysis, copilot for quick edits, etc.)
4. Do NOT change columnId — keep tasks in backlog
5. Output ALL tasks, even ones you don't change (just mark them "no changes needed")

## How to Update
Call PATCH on each task using the board API:
\`\`\`bash
curl -s -X PATCH http://localhost:${process.env.PORT || '3001'}/api/tasks/<TASK_ID> \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Improved title",
    "description": "**Goal:** ...\\n\\n**Context:** ...\\n\\n**Acceptance Criteria:**\\n- ...\\n\\n**Skills:** repo-scan\\n**Search:** grep -r \\"pattern\\" src/",
    "agentType": "opencode"
  }'
\`\`\`

Embed skill/search/asset/MCP suggestions as structured sections in the description. Do NOT add new task fields — the board has no dedicated fields for these yet.

Start with the first task and work through each one sequentially. After all tasks, output a summary of what you changed.`;
}

export function createGroomRouter(
  repo: TaskRepository,
  agentManager: AgentManager,
  projectRepo: ProjectRepository,
): Router {
  const router = Router();

  // POST /api/backlog/groom — groom all backlog tasks for a project
  router.post('/groom', asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.body;

    // Resolve project
    let resolvedProjectId = 'default';
    if (projectId && typeof projectId === 'string') {
      const project = await projectRepo.getById(projectId);
      if (project) resolvedProjectId = project.id;
    }

    // Fetch all backlog tasks for the project
    const allTasks = await repo.getAll(false, resolvedProjectId);
    const backlogTasks = allTasks.filter(t => t.columnId === 'backlog' && !t.archived);

    if (backlogTasks.length === 0) {
      res.status(400).json({ error: 'no backlog tasks to groom' });
      return;
    }

    if (backlogTasks.length > MAX_BACKLOG_FOR_GROOM) {
      res.status(400).json({ error: `too many backlog tasks (${backlogTasks.length}), max is ${MAX_BACKLOG_FOR_GROOM}` });
      return;
    }

    // Fetch agents — require opencode
    const agents = agentManager.getAvailableAgents();
    const groomer = agents.find(a => a.name === GROOMER_AGENT);
    if (!groomer?.available) {
      res.status(400).json({ error: `groomer agent (${GROOMER_AGENT}) is not available: ${groomer?.reason || 'unknown'}` });
      return;
    }

    const taskId = uuid();
    const task: Task = {
      id: taskId,
      projectId: GROOM_PROJECT_ID,
      title: `backlog-groom: ${backlogTasks.length} task(s) for ${resolvedProjectId}`,
      description: '',
      priority: 'medium',
      columnId: 'in-progress',
      agentStatus: 'planning',
      agentType: GROOMER_AGENT,
      createdAt: Date.now(),
      startedAt: Date.now(),
    };

    // Persist the grooming task
    await repo.create(task);
    broadcast({ type: 'task_updated', payload: task });

    // Inject the system prompt as a thinking event
    const systemPrompt = buildSystemPrompt({
      projectId: resolvedProjectId,
      tasks: backlogTasks,
    });

    const contextEvent = {
      id: uuid(),
      taskId,
      type: 'thinking' as const,
      content: systemPrompt,
      timestamp: Date.now(),
    };
    await repo.insertEvent(contextEvent);
    broadcast({ type: 'agent_event', payload: contextEvent });

    // Start the groomer agent
    agentManager.startAgent(task, makeStatusCallback(repo, taskId, agentManager));

    res.json({ taskId, backlogCount: backlogTasks.length });
  }));

  return router;
}
