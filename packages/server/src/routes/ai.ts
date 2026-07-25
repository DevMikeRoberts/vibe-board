import { Router, Request, Response } from 'express';
import { asyncHandler } from './helpers.js';

const IMPROVE_DESCRIPTION_SYSTEM_PROMPT = `You are an expert prompt engineer specializing in writing clear, actionable task descriptions for AI coding agents (Claude Code, GitHub Copilot, OpenCode, Codex, etc.).

Your job: rewrite a task description so an AI coding agent can understand and execute it with maximum precision and minimal ambiguity.

Rules:
- Use imperative style ("Implement...", "Add...", "Fix...", "Refactor...", "Create...")
- Be specific and concrete — name files, components, functions, or patterns where relevant
- Break complex tasks into numbered steps if the task has multiple phases
- Include acceptance criteria or expected outcomes where helpful
- Remove vague filler language; every sentence should add information
- Preserve the original intent — improve clarity, not scope
- Return ONLY the improved description text, no preamble, no "Here's the improved version:" header`;

export function createAiRouter(): Router {
  const router = Router();

  /**
   * POST /api/ai/improve-description
   * Body: { description: string, title?: string }
   * Returns: { improved: string }
   */
  router.post('/improve-description', asyncHandler(async (req: Request, res: Response) => {
    const { description, title } = req.body as { description?: string; title?: string };

    if (!description || typeof description !== 'string' || !description.trim()) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }

    const userContent = title?.trim()
      ? `Task title: ${title.trim()}\n\nTask description to improve:\n${description.trim()}`
      : `Task description to improve:\n${description.trim()}`;

    const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-20250414';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: IMPROVE_DESCRIPTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      console.error('[ai] improve-description API error:', response.status, body);
      res.status(502).json({ error: 'AI service returned an error' });
      return;
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text: string }>;
    };

    const improved = data.content?.find((c) => c.type === 'text')?.text?.trim();
    if (!improved) {
      res.status(502).json({ error: 'No text response from AI service' });
      return;
    }

    res.json({ improved });
  }));

  return router;
}
