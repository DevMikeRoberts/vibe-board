import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

const TEST_SERVER_PORT = process.env.E2E_SERVER_PORT ?? '3002';
export const API = `http://localhost:${TEST_SERVER_PORT}`;
const DEFAULT_TEST_REPO_NAME = 'test-repo';

type PrepareRepoOptions = {
  branch?: string;
  clean?: boolean;
  files?: Record<string, string>;
};

const preparedRepos = new Set<string>();

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || DEFAULT_TEST_REPO_NAME;
}

/** Run git without shell interpolation so paths with spaces work on every platform. */
export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

export function getTestRepoPath(name = DEFAULT_TEST_REPO_NAME): string {
  const root = process.env.E2E_TEST_REPO_ROOT
    ? path.resolve(process.env.E2E_TEST_REPO_ROOT)
    : path.resolve(process.cwd(), 'test-results', 'repos');
  return path.join(root, sanitizeRepoName(name));
}

function isGitRepo(repoPath: string): boolean {
  if (!existsSync(repoPath)) return false;
  try {
    git(['rev-parse', '--is-inside-work-tree'], repoPath);
    return true;
  } catch {
    return false;
  }
}

/** Prepare a deterministic, valid git repo for tests that need a local path. */
export function prepareTestRepo(name = DEFAULT_TEST_REPO_NAME, options: PrepareRepoOptions = {}): string {
  const repoPath = getTestRepoPath(name);
  const branch = options.branch ?? 'main';
  const files = options.files ?? {
    'README.md': '# E2E Test Repo\n\nRepository prepared by Playwright tests.\n',
  };
  const needsInit = options.clean || !preparedRepos.has(repoPath) || !isGitRepo(repoPath);

  if (!needsInit) return repoPath;

  rmSync(repoPath, { recursive: true, force: true });
  mkdirSync(repoPath, { recursive: true });

  try {
    git(['init', '-b', branch], repoPath);
  } catch {
    git(['init'], repoPath);
    git(['checkout', '-b', branch], repoPath);
  }

  git(['config', 'user.email', 'test@test.com'], repoPath);
  git(['config', 'user.name', 'E2E Test'], repoPath);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(repoPath, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  git(['add', '.'], repoPath);
  git(['commit', '--allow-empty', '-m', 'init'], repoPath);
  preparedRepos.add(repoPath);
  return repoPath;
}

export function cleanupTestPath(targetPath: string): void {
  rmSync(targetPath, { recursive: true, force: true });
}

export async function fillLocalPath(page: Page, repoPath = prepareTestRepo()): Promise<string> {
  await page.getByLabel(/Local Path/i).fill(repoPath);
  return repoPath;
}

/** Wait for the board to render all four column headings. */
export async function waitForBoard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'In Progress', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible();
}

/** Create a task via the REST API. Returns the parsed JSON response. */
export async function createTaskViaAPI(request: any, overrides: Record<string, any> = {}): Promise<any> {
  const res = await request.post(`${API}/api/tasks`, {
    data: {
      title: overrides.title || 'Test Task',
      description: 'Test',
      columnId: overrides.columnId || 'backlog',
      ...overrides,
    },
  });
  return res.json();
}

/** Delete a task by ID via the REST API (cleanup). */
export async function deleteTaskViaAPI(request: any, id: string): Promise<void> {
  await request.delete(`${API}/api/tasks/${id}`);
}
