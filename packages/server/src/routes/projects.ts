import { Router, Request, Response } from 'express';
import { spawnSync } from 'child_process';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { AgentType, Priority } from '../types.js';
import type { ProjectRepository } from '../repositories/project-types.js';
import type { TaskRepository } from '../repositories/types.js';
import type { TaskGroupRepository } from '../repositories/group-types.js';
import type { AgentManager } from '../services/agent-manager.js';
import { broadcast } from '../websocket.js';
import { MAX_TITLE_LENGTH, isValidAgentType, isValidPriority } from '@ai-agent-board/shared/constants.js';
import { errorMessage } from '../utils.js';
import {
  asyncHandler,
  broadcastProjectDelete,
  broadcastProjectUpdate,
  expandTilde,
  isAllowedRepoPath,
  isValidGitRef,
  normalizeRepoPathForCompare,
  paramId,
  validateRepoPath,
} from './helpers.js';

interface ParsedProjectDefaults {
  defaultAgentType?: AgentType | null;
  defaultPriority?: Priority | null;
  defaultBaseBranch?: string | null;
  defaultUseWorktree?: boolean | null;
}

/**
 * Validate and normalize the project-level task default fields from a request body.
 * When `allowNull` is true (PATCH), an explicit `null` clears a default and an empty
 * baseBranch string is treated as a clear. On create, empty/absent values are omitted.
 * Returns a parsed object, or a string error message.
 */
function parseProjectDefaults(body: Record<string, unknown>, allowNull: boolean): ParsedProjectDefaults | string {
  const out: ParsedProjectDefaults = {};

  if ('defaultAgentType' in body && body.defaultAgentType !== undefined) {
    const v = body.defaultAgentType;
    if (v === null) {
      if (!allowNull) return 'defaultAgentType must be a valid agent type';
      out.defaultAgentType = null;
    } else if (typeof v !== 'string' || !isValidAgentType(v)) {
      return 'defaultAgentType must be a valid agent type';
    } else {
      out.defaultAgentType = v;
    }
  }

  if ('defaultPriority' in body && body.defaultPriority !== undefined) {
    const v = body.defaultPriority;
    if (v === null) {
      if (!allowNull) return 'defaultPriority must be a valid priority';
      out.defaultPriority = null;
    } else if (typeof v !== 'string' || !isValidPriority(v)) {
      return 'defaultPriority must be a valid priority';
    } else {
      out.defaultPriority = v;
    }
  }

  if ('defaultBaseBranch' in body && body.defaultBaseBranch !== undefined) {
    const v = body.defaultBaseBranch;
    if (v === null) {
      if (allowNull) out.defaultBaseBranch = null;
    } else if (typeof v !== 'string') {
      return 'defaultBaseBranch must be a string';
    } else {
      const trimmed = v.trim();
      if (!trimmed) {
        if (allowNull) out.defaultBaseBranch = null;
      } else if (!isValidGitRef(trimmed)) {
        return 'defaultBaseBranch contains invalid characters';
      } else {
        out.defaultBaseBranch = trimmed;
      }
    }
  }

  if ('defaultUseWorktree' in body && body.defaultUseWorktree !== undefined) {
    const v = body.defaultUseWorktree;
    if (v === null) {
      if (allowNull) out.defaultUseWorktree = null;
    } else if (typeof v !== 'boolean') {
      return 'defaultUseWorktree must be a boolean';
    } else {
      out.defaultUseWorktree = v;
    }
  }

  return out;
}

export function createProjectsRouter(
  projectRepo: ProjectRepository,
  taskRepo: TaskRepository,
  groupRepo: TaskGroupRepository,
  agentManager: AgentManager,
): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req: Request, res: Response) => {
    res.json(await projectRepo.getAllWithCounts());
  }));

  router.post('/validate-path', asyncHandler(async (req: Request, res: Response) => {
    const { repoPath } = req.body;
    if (typeof repoPath !== 'string' || !repoPath.trim()) {
      res.status(400).json({ error: 'repoPath must be a non-empty string' }); return;
    }

    res.json(validateRepoPath(repoPath.trim()));
  }));

  router.post('/select-directory', asyncHandler(async (req: Request, res: Response) => {
    const initialPath = typeof req.body.initialPath === 'string' && req.body.initialPath.trim()
      ? expandTilde(req.body.initialPath.trim())
      : undefined;
    try {
      const selected = selectDirectory(initialPath);
      res.json({ repoPath: selected });
    } catch (err: unknown) {
      res.status(501).json({ error: errorMessage(err) });
    }
  }));

  router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    const project = id === 'default' ? await projectRepo.getDefault() : await projectRepo.getById(id);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }
    res.json(project);
  }));

  router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const { name, repoPath } = req.body;
    const projectName = typeof name === 'string' ? name.trim() : undefined;

    if (req.body.isDefault !== undefined) {
      res.status(400).json({ error: 'isDefault is immutable' }); return;
    }
    if (!projectName && repoPath === undefined) {
      res.status(400).json({ error: 'name or repoPath is required' }); return;
    }
    if (projectName !== undefined && !projectName) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    if (projectName && projectName.length > MAX_TITLE_LENGTH) {
      res.status(400).json({ error: `name must be at most ${MAX_TITLE_LENGTH} characters` }); return;
    }
    if (repoPath !== undefined && typeof repoPath !== 'string') {
      res.status(400).json({ error: 'repoPath must be a string' }); return;
    }

    let expandedRepoPath: string | undefined;
    if (typeof repoPath === 'string') {
      expandedRepoPath = expandTilde(repoPath);
      if (!path.isAbsolute(expandedRepoPath)) {
        res.status(400).json({ error: 'repoPath must be an absolute path' }); return;
      }
      const repoErr = isAllowedRepoPath(expandedRepoPath);
      if (repoErr) { res.status(400).json({ error: repoErr }); return; }
    }

    const now = Date.now();
    const defaults = parseProjectDefaults(req.body, false);
    if (typeof defaults === 'string') { res.status(400).json({ error: defaults }); return; }

    const project = await projectRepo.create({
      id: uuid(),
      name: projectName || path.basename(path.resolve(expandedRepoPath as string)),
      repoPath: expandedRepoPath,
      defaultAgentType: defaults.defaultAgentType ?? undefined,
      defaultPriority: defaults.defaultPriority ?? undefined,
      defaultBaseBranch: defaults.defaultBaseBranch ?? undefined,
      defaultUseWorktree: defaults.defaultUseWorktree ?? undefined,
      createdAt: now,
      updatedAt: now,
    });
    broadcastProjectUpdate(project);
    res.status(201).json(project);
  }));

  router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    if (req.body.isDefault !== undefined) {
      res.status(400).json({ error: 'isDefault is immutable' }); return;
    }
    const existing = await projectRepo.getById(id);
    if (!existing) { res.status(404).json({ error: 'project not found' }); return; }

    const updates: {
      name?: string;
      repoPath?: string | null;
      defaultAgentType?: AgentType | null;
      defaultPriority?: Priority | null;
      defaultBaseBranch?: string | null;
      defaultUseWorktree?: boolean | null;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' }); return;
      }
      if (req.body.name.length > MAX_TITLE_LENGTH) {
        res.status(400).json({ error: `name must be at most ${MAX_TITLE_LENGTH} characters` }); return;
      }
      updates.name = req.body.name.trim();
    }

    if (req.body.repoPath !== undefined) {
      if (req.body.repoPath !== null && typeof req.body.repoPath !== 'string') {
        res.status(400).json({ error: 'repoPath must be a string or null' }); return;
      }
      if (typeof req.body.repoPath === 'string') {
        const expandedRepoPath = expandTilde(req.body.repoPath);
        if (!path.isAbsolute(expandedRepoPath)) {
          res.status(400).json({ error: 'repoPath must be an absolute path' }); return;
        }
        const changed = isRepoPathChange(existing.repoPath, expandedRepoPath);
        if (changed && await projectRepo.hasTasksOrGroups(id)) {
          res.status(409).json({ error: 'repoPath cannot be changed after tasks or groups exist' }); return;
        }
        if (!changed) {
          updates.repoPath = existing.repoPath;
        } else {
          const repoErr = isAllowedRepoPath(expandedRepoPath);
          if (repoErr) { res.status(400).json({ error: repoErr }); return; }
          updates.repoPath = expandedRepoPath;
        }
      } else {
        if (isRepoPathChange(existing.repoPath, null) && await projectRepo.hasTasksOrGroups(id)) {
          res.status(409).json({ error: 'repoPath cannot be cleared after tasks or groups exist' }); return;
        }
        updates.repoPath = null;
      }
    }

    const parsedDefaults = parseProjectDefaults(req.body, true);
    if (typeof parsedDefaults === 'string') { res.status(400).json({ error: parsedDefaults }); return; }
    Object.assign(updates, parsedDefaults);

    const updated = await projectRepo.update(id, updates);
    if (!updated) { res.status(404).json({ error: 'project not found' }); return; }
    broadcastProjectUpdate(updated);
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = paramId(req);
    if (id === 'default') { res.status(409).json({ error: 'the default project cannot be deleted' }); return; }
    const project = await projectRepo.getById(id);
    if (!project) { res.status(404).json({ error: 'project not found' }); return; }

    // Stop any running group queues + their agents before removing rows.
    const groups = await groupRepo.getAll(true, id);
    for (const group of groups) {
      await agentManager.stopGroup(group.id);
    }

    // Collect every task in the project: standalone tasks plus group children.
    const standaloneTasks = await taskRepo.getAll(true, id);
    const childTasks = (await Promise.all(groups.map((g) => groupRepo.getChildTasks(g.id)))).flat();
    const tasks = [...standaloneTasks, ...childTasks];

    // Stop agents, drop cached events, and clean up worktrees (best effort).
    for (const task of tasks) {
      await agentManager.stopAgent(task.id);
      agentManager.clearEvents(task.id);
      if (task.worktreePath) {
        try { agentManager.removeWorktree(task); } catch { /* best effort */ }
      }
    }

    const deleted = await projectRepo.delete(id);
    if (!deleted) { res.status(409).json({ error: 'project cannot be deleted' }); return; }

    for (const task of tasks) {
      broadcast({ type: 'task_deleted', payload: { id: task.id } });
    }
    broadcastProjectDelete(id);
    res.status(204).send();
  }));

  return router;
}

function isRepoPathChange(existing: string | undefined, next: string | null): boolean {
  if (!existing && next === null) return false;
  if (!existing || next === null) return true;
  return normalizeRepoPathForCompare(existing) !== normalizeRepoPathForCompare(next);
}

function selectDirectory(initialPath?: string): string | null {
  if (process.platform === 'win32') return selectDirectoryWindows(initialPath);
  if (process.platform === 'darwin') return selectDirectoryMac();
  return selectDirectoryLinux(initialPath);
}

function selectDirectoryWindows(initialPath?: string): string | null {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select project folder'
$dialog.ShowNewFolderButton = $true
if ($env:AI_AGENT_BOARD_INITIAL_DIR -and [System.IO.Directory]::Exists($env:AI_AGENT_BOARD_INITIAL_DIR)) {
  $dialog.SelectedPath = $env:AI_AGENT_BOARD_INITIAL_DIR
}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
  exit 0
}
exit 2
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, AI_AGENT_BOARD_INITIAL_DIR: initialPath ?? '' },
  });
  if (result.status === 0) return result.stdout.trim() || null;
  if (result.status === 2) return null;
  throw new Error(`Folder picker failed: ${result.stderr.trim() || result.error?.message || `exit ${result.status}`}`);
}

function selectDirectoryMac(): string | null {
  const result = spawnSync('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select project folder")'], {
    encoding: 'utf8',
  });
  if (result.status === 0) return result.stdout.trim() || null;
  if (result.stderr.includes('User canceled')) return null;
  throw new Error(`Folder picker failed: ${result.stderr.trim() || result.error?.message || `exit ${result.status}`}`);
}

function selectDirectoryLinux(initialPath?: string): string | null {
  const commands: Array<{ command: string; args: string[] }> = [
    { command: 'zenity', args: ['--file-selection', '--directory', '--title=Select project folder'] },
    { command: 'kdialog', args: ['--getexistingdirectory', initialPath ?? '.'] },
  ];
  for (const { command, args } of commands) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    if (result.status === 0) return result.stdout.trim() || null;
    if (result.status === 1) return null;
    throw new Error(`Folder picker failed: ${result.stderr.trim() || errorMessage(result.error) || `exit ${result.status}`}`);
  }
  throw new Error('Folder picker is not available on this server. Install zenity or kdialog, or type the path manually.');
}
