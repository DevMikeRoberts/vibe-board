import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { asyncHandler } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the repository root — navigate from src/routes to the repo root
function getRepoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

export function createSystemRouter(): Router {
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

  return router;
}
