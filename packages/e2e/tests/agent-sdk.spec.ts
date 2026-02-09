import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * End-to-end tests for real Copilot SDK agent execution.
 * Uses Playwright for UI verification + API for agent lifecycle.
 * Requires GitHub Copilot CLI installed and authenticated.
 */

const TEST_REPO = process.env.TEST_REPO || '/root/projects/upload-download-app';
const AGENT_TIMEOUT = 120_000;

async function waitForBoard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible({ timeout: 10_000 });
}

async function createTaskViaUI(page: Page, title: string, description: string) {
  const backlogHeading = page.getByRole('heading', { name: 'Backlog' });
  const headerRow = backlogHeading.locator('..').locator('..');
  await headerRow.locator('button').first().click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
  await page.getByPlaceholder('What needs to be done?').fill(title);
  await page.getByPlaceholder('Describe the task for the Copilot agent...').fill(description);
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
}

async function waitForAgentComplete(request: any, taskId: string, timeout = AGENT_TIMEOUT) {
  // Wait for BOTH task_complete event AND status update (they can lag)
  await expect(async () => {
    const res = await request.get('http://localhost:3001/api/tasks');
    const tasks = await res.json();
    const task = tasks.find((t: any) => t.id === taskId);
    expect(task.agentStatus).toBe('complete');
  }).toPass({ timeout, intervals: [3_000] });
}

function getTaskByTitle(tasks: any[], title: string) {
  const task = tasks.find((t: any) => t.title === title);
  expect(task).toBeTruthy();
  return task;
}

test.describe('Copilot SDK Agent', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure test repo is clean before each test
    execSync('git checkout -- .', { cwd: TEST_REPO });
    execSync('git worktree prune', { cwd: TEST_REPO });
    await page.goto('/');
    await waitForBoard(page);
  });

  test('run agent without worktree — full flow', async ({ page, request }) => {
    test.setTimeout(AGENT_TIMEOUT);
    const ts = Date.now();
    const title = `E2E Agent ${ts}`;

    // 1. Create task via UI — verify it appears on board
    await createTaskViaUI(page, title, 'Add a comment line at the very top of README.md: <!-- E2E test -->');

    // 2. Get task ID from API
    const tasks = await (await request.get('http://localhost:3001/api/tasks')).json();
    const task = getTaskByTitle(tasks, title);
    expect(task.columnId).toBe('backlog');

    // 3. Configure + move + run via API
    await request.post(`http://localhost:3001/api/tasks/${task.id}/configure`, {
      data: { repoPath: TEST_REPO, useWorktree: false },
    });
    await request.patch(`http://localhost:3001/api/tasks/${task.id}`, {
      data: { columnId: 'in-progress' },
    });
    await request.post(`http://localhost:3001/api/tasks/${task.id}/run`);

    // 4. Click task card to open agent panel — verify events stream in
    await page.getByRole('heading', { name: title }).click();
    await expect(page.getByText(/Starting|Intent|view|edit|task_complete/i).first())
      .toBeVisible({ timeout: 60_000 });

    // 5. Wait for agent to complete (polls until agentStatus === 'complete')
    await waitForAgentComplete(request, task.id);

    // 6. Verify task moved to review
    const finalTasks = await (await request.get('http://localhost:3001/api/tasks')).json();
    const finalTask = getTaskByTitle(finalTasks, title);
    expect(finalTask.columnId).toBe('review');

    // 7. Clean up repo changes
    execSync('git checkout -- .', { cwd: TEST_REPO });
  });

  test('run agent with worktree — isolation verified', async ({ page, request }) => {
    test.setTimeout(AGENT_TIMEOUT);
    const ts = Date.now();
    const title = `E2E Worktree ${ts}`;
    const branchName = `e2e-wt-${ts}`;

    // 1. Create task via UI
    await createTaskViaUI(page, title, 'Add a comment at the top of README.md: <!-- worktree test -->');

    // 2. Get task ID
    const tasks = await (await request.get('http://localhost:3001/api/tasks')).json();
    const task = getTaskByTitle(tasks, title);

    // 3. Configure with worktree + run agent
    await request.post(`http://localhost:3001/api/tasks/${task.id}/configure`, {
      data: { repoPath: TEST_REPO, useWorktree: true, branchName, baseBranch: 'master' },
    });
    await request.patch(`http://localhost:3001/api/tasks/${task.id}`, {
      data: { columnId: 'in-progress' },
    });
    await request.post(`http://localhost:3001/api/tasks/${task.id}/run`);

    // 4. Wait for completion
    await waitForAgentComplete(request, task.id);

    // 5. Verify main repo is CLEAN
    const mainStatus = execSync('git status --porcelain', { cwd: TEST_REPO }).toString().trim();
    expect(mainStatus).toBe('');

    // 6. Verify worktree has changes
    const finalTasks = await (await request.get('http://localhost:3001/api/tasks')).json();
    const finalTask = getTaskByTitle(finalTasks, title);
    expect(finalTask.worktreePath).toBeTruthy();
    const wtDiff = execSync('git diff HEAD -- README.md', { cwd: finalTask.worktreePath }).toString();
    expect(wtDiff.length).toBeGreaterThan(0);

    // 7. Open agent panel in UI and verify events rendered
    await page.getByRole('heading', { name: title }).click();
    await expect(page.getByText(/worktree created|task_complete/i).first())
      .toBeVisible({ timeout: 5_000 });

    // 8. Clean up
    await request.post(`http://localhost:3001/api/tasks/${task.id}/cleanup-worktree`);
    execSync('git worktree prune', { cwd: TEST_REPO });
    try { execSync(`git branch -D ${branchName}`, { cwd: TEST_REPO }); } catch {}
  });
});
