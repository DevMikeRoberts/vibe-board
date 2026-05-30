import { test, expect, type Page } from '@playwright/test';
import { API, fillLocalPath, waitForBoard } from './helpers';

// Helper to open the create task dialog
async function openCreateDialog(page: Page) {
  const backlogHeading = page.getByRole('heading', { name: 'Backlog', exact: true });
  const headerRow = backlogHeading.locator('..').locator('..');
  const addButton = headerRow.locator('button').first();
  await addButton.click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
}

// Helper to create a task — returns task ID via API lookup
async function createTask(page: Page, title: string, description = 'Test description'): Promise<string> {
  await openCreateDialog(page);
  await page.getByPlaceholder('What needs to be done?').fill(title);
  await page.getByPlaceholder('Describe the task for the selected agent...').fill(description);
  // Local path is required
  await fillLocalPath(page);
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
  const id = await page.evaluate(async (t) => {
    const res = await fetch('/api/tasks');
    const tasks = await res.json();
    return tasks.find((tk: any) => tk.title === t)?.id ?? null;
  }, title);
  return id as string;
}

test.describe('Kanban Board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('renders all four columns', async ({ page }) => {
    for (const col of ['Backlog', 'In Progress', 'Review', 'Done']) {
      await expect(page.getByRole('heading', { name: col, exact: true })).toBeVisible();
    }
  });

  test('shows app title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'AI Agent Board' })).toBeVisible();
  });

  test('has theme toggle button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });
});

test.describe('Task CRUD', () => {
  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTaskIds = [];
    await page.goto('/');
    await waitForBoard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdTaskIds) {
      await request.delete(`${API}/api/tasks/${id}`).catch(() => {});
    }
    createdTaskIds = [];
  });

  test('create a new task', async ({ page }) => {
    const ts = Date.now();
    const taskTitle = `E2E Task ${ts}`;
    const taskDesc = `Automated test description ${ts}`;
    const id = await createTask(page, taskTitle, taskDesc);
    createdTaskIds.push(id);
    await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible();
    await expect(page.getByText(taskDesc).first()).toBeVisible();
  });

  test('create task dialog opens and closes', async ({ page }) => {
    await openCreateDialog(page);
    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('What needs to be done?')).not.toBeVisible({ timeout: 2_000 });
  });

  test('create task requires title', async ({ page }) => {
    await openCreateDialog(page);
    const createButton = page.getByRole('button', { name: 'Create Task' });
    await expect(createButton).toBeDisabled();
    await page.getByPlaceholder('What needs to be done?').fill('Valid Task');
    await expect(createButton).toBeEnabled();
    // Close without submitting
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('click task to open agent panel', async ({ page }) => {
    const taskTitle = `Panel Task ${Date.now()}`;
    const taskId = await createTask(page, taskTitle);
    createdTaskIds.push(taskId);

    await page.evaluate(async (id) => {
      await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: 'in-progress' }),
      });
    }, taskId);

    await page.reload();
    await waitForBoard(page);
    await page.getByRole('heading', { name: taskTitle }).click();
    await expect(page.getByRole('button', { name: 'Run agent' })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('No agent activity yet')).toBeVisible();
  });

  test('Summary tab appears for review tasks and opens by default', async ({ page }) => {
    const taskTitle = `Review Panel ${Date.now()}`;
    const taskId = await createTask(page, taskTitle);
    createdTaskIds.push(taskId);

    // Move backlog -> in-progress -> review via valid transitions
    await page.evaluate(async (id) => {
      const patch = (body: unknown) =>
        fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      await patch({ columnId: 'in-progress' });
      await patch({ columnId: 'review' });
    }, taskId);

    await page.reload();
    await waitForBoard(page);
    await page.getByRole('heading', { name: taskTitle }).click();

    // Summary tab is present and selected by default (empty-state visible)
    await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('No summary was provided for this task.')).toBeVisible();
  });

  test('Summary tab is hidden for in-progress tasks', async ({ page }) => {
    const taskTitle = `Progress Panel ${Date.now()}`;
    const taskId = await createTask(page, taskTitle);
    createdTaskIds.push(taskId);

    await page.evaluate(async (id) => {
      await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: 'in-progress' }),
      });
    }, taskId);

    await page.reload();
    await waitForBoard(page);
    await page.getByRole('heading', { name: taskTitle }).click();

    await expect(page.getByRole('button', { name: 'Run agent' })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('button', { name: 'Summary', exact: true })).toHaveCount(0);
  });

  test('dragging task to In Progress starts the agent', async ({ page }) => {
    const taskTitle = `Drag Start Task ${Date.now()}`;
    const taskId = await createTask(page, taskTitle);
    createdTaskIds.push(taskId);

    let runRequests = 0;
    await page.route(`**/api/tasks/${taskId}/run`, async (route) => {
      runRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: taskId,
          title: taskTitle,
          description: 'Test description',
          priority: 'medium',
          columnId: 'in-progress',
          agentStatus: 'planning',
          agentType: 'copilot',
          createdAt: Date.now(),
        }),
      });
    });

    const taskCard = page.locator('[data-column="backlog"] .group').filter({
      has: page.getByRole('heading', { name: taskTitle }),
    });
    const targetColumn = page.locator('[data-column="in-progress"]');
    await taskCard.scrollIntoViewIfNeeded();

    const sourceBox = await taskCard.boundingBox();
    const targetBox = await targetColumn.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 20 });
    await page.mouse.up();

    await expect.poll(() => runRequests).toBe(1);
  });
});

test.describe('Theme Toggle', () => {
  test('toggles between dark and light mode', async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);

    const themeButton = page.getByRole('button', { name: 'Toggle theme' });
    const html = page.locator('html');
    const initialClass = await html.getAttribute('class');

    await themeButton.click();
    await page.waitForTimeout(300);
    const newClass = await html.getAttribute('class');
    expect(newClass).not.toBe(initialClass);

    await themeButton.click();
    await page.waitForTimeout(300);
    const revertedClass = await html.getAttribute('class');
    expect(revertedClass).toBe(initialClass);
  });
});

test.describe('Task Edit', () => {
  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTaskIds = [];
    await page.goto('/');
    await waitForBoard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdTaskIds) {
      await request.delete(`${API}/api/tasks/${id}`).catch(() => {});
    }
    createdTaskIds = [];
  });

  test('edit button opens dialog with pre-populated data', async ({ page }) => {
    const ts = Date.now();
    const taskTitle = `Editable Task ${ts}`;
    const taskId = await createTask(page, taskTitle, 'Original description');
    createdTaskIds.push(taskId);

    const taskCard = page.locator('.group').filter({ has: page.getByRole('heading', { name: taskTitle }) });
    await taskCard.hover();
    await taskCard.getByRole('button', { name: 'Edit task' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible();
    await expect(page.getByPlaceholder('What needs to be done?')).toHaveValue(taskTitle);
    await expect(page.getByPlaceholder('Describe the task for the selected agent...')).toHaveValue('Original description');

    const newTitle = `Edited Task ${ts}`;
    await page.getByPlaceholder('What needs to be done?').fill(newTitle);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Task' })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('heading', { name: newTitle })).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Task Priority', () => {
  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTaskIds = [];
    await page.goto('/');
    await waitForBoard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdTaskIds) {
      await request.delete(`${API}/api/tasks/${id}`).catch(() => {});
    }
    createdTaskIds = [];
  });

  test('create task with high priority shows amber left border', async ({ page }) => {
    const ts = Date.now();
    const taskTitle = `Priority Task ${ts}`;

    await openCreateDialog(page);
    await page.getByPlaceholder('What needs to be done?').fill(taskTitle);
    // Local path is required
    await fillLocalPath(page);

    // Open priority dropdown within the dialog and select High
    const dialog = page.getByRole('dialog');
    // The priority dropdown button contains the emoji and label as separate elements
    // Click the button that currently shows "Medium" (the priority selector)
    const priorityButton = dialog.locator('button', { hasText: 'Medium' }).first();
    await priorityButton.click();
    await dialog.getByRole('button', { name: '🟠 High' }).click();

    await page.getByRole('button', { name: 'Create Task' }).click();
    await expect(page.getByRole('heading', { name: 'Create Task' })).not.toBeVisible({ timeout: 3_000 });

    // Get the task ID for cleanup
    const id = await page.evaluate(async (t) => {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();
      return tasks.find((tk: any) => tk.title === t)?.id ?? null;
    }, taskTitle);
    createdTaskIds.push(id as string);

    // Verify the task card has amber left border
    const taskCard = page.locator('.group').filter({ has: page.getByRole('heading', { name: taskTitle }) });
    await expect(taskCard).toHaveClass(/border-l-amber-500/);
  });

  test('edit task priority updates the border color', async ({ page }) => {
    const ts = Date.now();
    const taskTitle = `Edit Priority ${ts}`;
    const id = await createTask(page, taskTitle);
    createdTaskIds.push(id);

    // Default priority is medium — no visible border (medium is borderless)
    const taskCard = page.locator('.group').filter({ has: page.getByRole('heading', { name: taskTitle }) });
    await expect(taskCard).not.toHaveClass(/border-l-4/);

    // Edit task and change priority to critical
    await taskCard.hover();
    await taskCard.getByRole('button', { name: 'Edit task' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible();

    // Open priority dropdown and select Critical
    const dialog = page.getByRole('dialog');
    const priorityButton = dialog.locator('button', { hasText: 'Medium' }).first();
    await priorityButton.click();
    await dialog.getByRole('button', { name: '🔴 Critical' }).click();

    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Task' })).not.toBeVisible({ timeout: 2_000 });

    // Verify the task card now has red left border
    await expect(taskCard).toHaveClass(/border-l-red-500/, { timeout: 3_000 });
  });
});

test.describe('Task Sorting', () => {
  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTaskIds = [];
    await page.goto('/');
    await waitForBoard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdTaskIds) {
      await request.delete(`${API}/api/tasks/${id}`).catch(() => {});
    }
    createdTaskIds = [];
  });

  test('sort dropdown changes task order by priority', async ({ page, request }) => {
    // Create tasks with different priorities via API
    const tasks = [
      { title: 'Sort Low Task', priority: 'low' },
      { title: 'Sort Critical Task', priority: 'critical' },
      { title: 'Sort High Task', priority: 'high' },
    ];
    for (const t of tasks) {
      const res = await request.post(`${API}/api/tasks`, { data: { title: t.title, description: 'sort test', priority: t.priority } });
      const created = await res.json();
      createdTaskIds.push(created.id);
    }

    await page.reload();
    await waitForBoard(page);

    // Change sort to Priority ascending (critical first)
    const sortSelect = page.locator('select');
    await sortSelect.selectOption('priority');

    // Get task titles in backlog column order
    const backlog = page.locator('[data-column="backlog"]').first();
    const headings = backlog.locator('h3');
    const titles = await headings.allTextContents();

    // Filter to just our test tasks (titles include priority emoji prefix)
    const sortTitles = titles.filter(t => t.includes('Sort '));
    expect(sortTitles[0]).toContain('Sort Critical Task');
    expect(sortTitles[sortTitles.length - 1]).toContain('Sort Low Task');
  });
});

test.describe('Filter Chips', () => {
  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTaskIds = [];
    await page.goto('/');
    await waitForBoard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdTaskIds) {
      await request.delete(`${API}/api/tasks/${id}`).catch(() => {});
    }
    createdTaskIds = [];
  });

  test('filter by agent type shows only matching tasks', async ({ page, request }) => {
    // Create tasks with different agent types via API
    const res1 = await request.post(`${API}/api/tasks`, { data: { title: 'Filter Claude Task', description: 'test', agentType: 'claude' } });
    const res2 = await request.post(`${API}/api/tasks`, { data: { title: 'Filter Copilot Task', description: 'test', agentType: 'copilot' } });
    createdTaskIds.push((await res1.json()).id, (await res2.json()).id);

    await page.reload();
    await waitForBoard(page);

    // Both tasks should be visible
    await expect(page.getByRole('heading', { name: 'Filter Claude Task' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter Copilot Task' })).toBeVisible();

    // Click Filter toggle then Claude filter chip
    await page.getByLabel('Toggle filters').click();
    await page.getByRole('button', { name: 'Claude', exact: true }).click();

    // Only Claude task should be visible
    await expect(page.getByRole('heading', { name: 'Filter Claude Task' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter Copilot Task' })).not.toBeVisible({ timeout: 2_000 });

    // Click Clear to reset
    await page.getByRole('button', { name: 'Clear' }).click();

    // Both visible again
    await expect(page.getByRole('heading', { name: 'Filter Claude Task' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filter Copilot Task' })).toBeVisible();
  });
});

test.describe('Retry Failed Tasks', () => {
  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTaskIds = [];
    await page.goto('/');
    await waitForBoard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of createdTaskIds) {
      await request.delete(`${API}/api/tasks/${id}`).catch(() => {});
    }
    createdTaskIds = [];
  });

  test('retry button appears on failed tasks', async ({ page, request }) => {
    // Create a task and set it to failed via API
    const res = await request.post(`${API}/api/tasks`, {
      data: { title: 'Retry Test Task', description: 'test', columnId: 'in-progress' },
    });
    const task = await res.json();
    createdTaskIds.push(task.id);

    // Mark as failed
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { agentStatus: 'failed' },
    });

    await page.reload();
    await waitForBoard(page);

    // Hover over the task card to reveal action buttons
    const taskCard = page.locator('.group').filter({ has: page.getByRole('heading', { name: 'Retry Test Task' }) });
    await taskCard.hover();

    // Retry button should be visible
    await expect(taskCard.getByRole('button', { name: 'Retry task' })).toBeVisible();
  });
});
