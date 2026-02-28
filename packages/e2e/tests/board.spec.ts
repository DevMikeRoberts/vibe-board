import { test, expect, type Page } from '@playwright/test';

const API = 'http://localhost:3001';

// Helper to wait for the board to render
async function waitForBoard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Backlog', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'In Progress', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible();
}

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
  await page.getByPlaceholder('Describe the task for the Copilot agent...').fill(description);
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
    await expect(page.getByRole('heading', { name: 'Copilot Kanban' })).toBeVisible();
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
    await expect(page.getByPlaceholder('Describe the task for the Copilot agent...')).toHaveValue('Original description');

    const newTitle = `Edited Task ${ts}`;
    await page.getByPlaceholder('What needs to be done?').fill(newTitle);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Task' })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('heading', { name: newTitle })).toBeVisible({ timeout: 5_000 });
  });
});
