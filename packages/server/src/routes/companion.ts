import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { Task } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import { broadcast } from '../websocket.js';
import type { AgentManager } from '../services/agent-manager.js';
import { asyncHandler, makeStatusCallback } from './helpers.js';

const COMPANION_PROJECT_ID = '__companion__';

const SYSTEM_PROMPT = `You are the AI Agent Board companion — a helpful 8-bit sidekick who lives in the developer's Kanban board. You are chatting through a companion panel.

When the user asks you to do something, help them. Here are things you can do:

1. **Open a new project**: If they want to open/start a new project, ask for details and help them plan.
2. **Plan tasks**: If they want to plan multiple tasks for their project, break their request into concrete, actionable tasks with clear titles and descriptions.
3. **Create tickets/tasks**: Create well-structured task descriptions they can add to the board.
4. **Look at PRs**: If they want to check on PRs or fix issues, guide them through the process.
5. **General coding help**: Answer questions, suggest approaches, debug issues.

Be concise and friendly. Use markdown when helpful. End your response with a clear summary of what you've done or suggested next steps.

If the user's request is vague, ask clarifying questions before taking action.`;

export function createCompanionRouter(
  repo: TaskRepository,
  agentManager: AgentManager,
): Router {
  const router = Router();

  // POST /api/companion/chat — create a temporary task and run the opencode agent
  router.post('/chat', asyncHandler(async (req: Request, res: Response) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const taskId = uuid();
    const task: Task = {
      id: taskId,
      projectId: COMPANION_PROJECT_ID,
      title: `companion: ${message.slice(0, 80)}`,
      description: '',
      priority: 'medium',
      columnId: 'in-progress',
      agentStatus: 'planning',
      agentType: 'opencode',
      createdAt: Date.now(),
      startedAt: Date.now(),
    };

    // Persist the task
    await repo.create(task);
    broadcast({ type: 'task_updated', payload: task });

    // Persist the system context as a thinking event
    const contextEvent = {
      id: uuid(),
      taskId,
      type: 'thinking' as const,
      content: SYSTEM_PROMPT + '\n\n---\n\nUser message: ' + message.trim(),
      timestamp: Date.now(),
    };
    await repo.insertEvent(contextEvent);
    broadcast({ type: 'agent_event', payload: contextEvent });

    // Start the agent
    agentManager.startAgent(task, makeStatusCallback(repo, taskId, agentManager));

    res.json({ taskId });
  }));

  return router;
}
