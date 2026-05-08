import { test, expect, type Page } from '@playwright/test';
import { API, fillLocalPath, git, prepareTestRepo } from './helpers';

/**
 * End-to-end tests for real Copilot SDK agent execution.
 * Uses Playwright for UI verification + API for agent lifecycle.
 * Requires GitHub Copilot CLI installed and authenticated.
 */

const AGENT_TIMEOUT = 120_000;
let testRepo = '';
let copilotAvailable = false;

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
  // Local path is required
  await fillLocalPath(page, testRepo);
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
}

async function waitForAgentComplete(request: any, taskId: string, timeout = AGENT_TIMEOUT) {
  // Wait for BOTH task_complete event AND status update (they can lag)
  await expect(async () => {
    const res = await request.get(`${API}/api/tasks`);
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

async function getCopilotAvailability(request: any): Promise<boolean> {
  const res = await request.get(`${API}/api/agents`);
  if (!res.ok()) return false;
  const agents = await res.json();
  return agents.some((agent: any) => agent.name === 'copilot' && agent.available);
}

test.describe('Copilot SDK Agent', () => {
  test.beforeAll(async ({ request }) => {
    copilotAvailable = await getCopilotAvailability(request);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!copilotAvailable, 'Copilot agent is unavailable or unauthenticated; skipping external integration test');
    testRepo = prepareTestRepo('agent-sdk', { clean: true, branch: 'main' });
    // Ensure test repo is clean before each test
    git(['checkout', '--', '.'], testRepo);
    git(['clean', '-fd'], testRepo);
    git(['worktree', 'prune'], testRepo);
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
    const tasks = await (await request.get(`${API}/api/tasks`)).json();
    const task = getTaskByTitle(tasks, title);
    expect(task.columnId).toBe('backlog');

    // 3. Configure + move + run via API
    await request.post(`${API}/api/tasks/${task.id}/configure`, {
      data: { repoPath: testRepo, useWorktree: false },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { columnId: 'in-progress' },
    });
    await request.post(`${API}/api/tasks/${task.id}/run`);

    // 4. Click task card to open agent panel — verify events stream in
    await page.getByRole('heading', { name: title }).click();
    await expect(page.getByText(/Starting|Intent|view|edit|task_complete/i).first())
      .toBeVisible({ timeout: 60_000 });

    // 5. Wait for agent to complete (polls until agentStatus === 'complete')
    await waitForAgentComplete(request, task.id);

    // 6. Verify task moved to review
    const finalTasks = await (await request.get(`${API}/api/tasks`)).json();
    const finalTask = getTaskByTitle(finalTasks, title);
    expect(finalTask.columnId).toBe('review');

    // 7. Clean up repo changes
    git(['checkout', '--', '.'], testRepo);
  });

  test('run agent with worktree — isolation verified', async ({ page, request }) => {
    test.setTimeout(AGENT_TIMEOUT);
    const ts = Date.now();
    const title = `E2E Worktree ${ts}`;
    const branchName = `e2e-wt-${ts}`;

    // 1. Create task via UI
    await createTaskViaUI(page, title, 'Add a comment at the top of README.md: <!-- worktree test -->');

    // 2. Get task ID
    const tasks = await (await request.get(`${API}/api/tasks`)).json();
    const task = getTaskByTitle(tasks, title);

    // 3. Configure with worktree + run agent
    await request.post(`${API}/api/tasks/${task.id}/configure`, {
      data: { repoPath: testRepo, useWorktree: true, branchName, baseBranch: 'main' },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { columnId: 'in-progress' },
    });
    await request.post(`${API}/api/tasks/${task.id}/run`);

    // 4. Wait for completion
    await waitForAgentComplete(request, task.id);

    // 5. Verify main repo is CLEAN
    const mainStatus = git(['status', '--porcelain'], testRepo).trim();
    expect(mainStatus).toBe('');

    // 6. Verify worktree has changes
    const finalTasks = await (await request.get(`${API}/api/tasks`)).json();
    const finalTask = getTaskByTitle(finalTasks, title);
    expect(finalTask.worktreePath).toBeTruthy();
    const wtDiff = git(['diff', 'HEAD', '--', 'README.md'], finalTask.worktreePath);
    expect(wtDiff.length).toBeGreaterThan(0);

    // 7. Open agent panel in UI and verify events rendered
    await page.getByRole('heading', { name: title }).click();
    await expect(page.getByText(/worktree created|task_complete/i).first())
      .toBeVisible({ timeout: 5_000 });

    // 8. Clean up
    await request.post(`${API}/api/tasks/${task.id}/cleanup-worktree`);
    git(['worktree', 'prune'], testRepo);
    try { git(['branch', '-D', branchName], testRepo); } catch {}
  });
});
