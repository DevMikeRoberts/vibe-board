import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler, broadcastProjectUpdate } from './helpers.js';
import { getGithubToken, getGithubTokenSource, setGithubToken } from '../config.js';
import { autoLoadPersonalRepos, fetchGithubUser } from '../services/repo-loader.js';
import type { ProjectRepository } from '../repositories/project-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the repository root — navigate from src/routes to the repo root
function getRepoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

export function createSystemRouter(projectRepo?: ProjectRepository): Router {
  const router = Router();

  // POST /api/system/restart — pull latest code and gracefully restart the server
  router.post('/restart', asyncHandler(async (_req: Request, res: Response) => {
    const repoRoot = getRepoRoot();

    try {
      console.log(`[system] restarting: pulling latest code from ${repoRoot}`);

      // Git pull latest code
      execSync('git pull', { cwd: repoRoot, stdio: 'inherit' });

      // Send success response before shutting down
      res.json({ success: true, message: 'Server restarting...' });

      // Give the response time to be sent, then exit gracefully
      // The systemd service will automatically restart the process
      setTimeout(() => {
        console.log('[system] initiating graceful shutdown');
        process.exit(0);
      }, 500);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[system] restart failed: ${error}`);
      res.status(500).json({ error: `Restart failed: ${error}` });
    }
  }));

  // GET /api/system/github-status — check if a GitHub token is configured
  router.get('/github-status', asyncHandler(async (_req: Request, res: Response) => {
    const tokenSource = getGithubTokenSource();
    if (!tokenSource) {
      res.json({ configured: false, tokenSource: null });
      return;
    }

    const token = getGithubToken()!;
    const user = await fetchGithubUser(token);
    res.json({
      configured: true,
      tokenSource,
      username: user?.login ?? null,
      name: user?.name ?? null,
    });
  }));

  // POST /api/system/github-token — save a GitHub token to the config file
  router.post('/github-token', asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body;
    if (typeof token !== 'string') {
      res.status(400).json({ error: 'token must be a string' });
      return;
    }
    const trimmed = token.trim();
    if (!trimmed) {
      res.status(400).json({ error: 'token must not be empty' });
      return;
    }

    // Validate the token by fetching user info
    const user = await fetchGithubUser(trimmed);
    if (!user) {
      res.status(401).json({ error: 'Invalid GitHub token — could not authenticate' });
      return;
    }

    setGithubToken(trimmed);
    res.json({ success: true, username: user.login, name: user.name ?? null });
  }));

  // POST /api/system/import-github-repos — trigger a GitHub repo import
  router.post('/import-github-repos', asyncHandler(async (req: Request, res: Response) => {
    if (!projectRepo) {
      res.status(503).json({ error: 'project repository not available' });
      return;
    }

    // Allow an explicit token in the request body (for first-time setup before token is saved)
    const bodyToken = typeof req.body.token === 'string' ? req.body.token.trim() : undefined;
    const activeToken = bodyToken || getGithubToken();

    if (!activeToken) {
      res.status(400).json({ error: 'No GitHub token configured. Provide a token or set GITHUB_TOKEN.' });
      return;
    }

    try {
      const result = await autoLoadPersonalRepos(projectRepo, activeToken);

      // Broadcast project updates so connected clients see new projects immediately
      if (result.imported > 0) {
        const allProjects = await projectRepo.getAllWithCounts();
        for (const project of allProjects) {
          broadcastProjectUpdate(project);
        }
      }

      res.json(result);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[system] import-github-repos failed: ${error}`);
      res.status(500).json({ error });
    }
  }));

  return router;
}
