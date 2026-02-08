import { test, expect, type Page } from '@playwright/test';

// Helper to wait for the board to render
async function waitForBoard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
}

// Helper to open the create task dialog
async function openCreateDialog(page: Page) {
  // The + button is next to the Backlog heading inside the column header
  const backlogHeading = page.getByRole('heading', { name: 'Backlog' });
  // The + button is a sibling in the column header div - go up to the header row then find the button
  const headerRow = backlogHeading.locator('..').locator('..');
  const addButton = headerRow.locator('button').first();
  await addButton.click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
}

// Helper to create a task
async function createTask(page: Page, title: string, description = 'Test description') {
  await openCreateDialog(page);
  await page.getByPlaceholder('What needs to be done?').fill(title);
  await page.getByPlaceholder('Describe the task for the Copilot agent...').fill(description);
  await page.getByRole('button', { name: 'Create Task' }).click();
  // Wait for dialog to close and task to appear
  await expect(page.getByRole('heading', { name: 'Create Task' })).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
}

test.describe('Kanban Board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('renders all four columns', async ({ page }) => {
    for (const col of ['Backlog', 'In Progress', 'Review', 'Done']) {
      await expect(page.getByRole('heading', { name: col })).toBeVisible();
    }
  });

  test('shows app title and task count', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Copilot Kanban' })).toBeVisible();
    await expect(page.getByText(/\d+ tasks/)).toBeVisible();
  });

  test('has theme toggle button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  });
});

test.describe('Task CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('create a new task', async ({ page }) => {
    const ts = Date.now();
    const taskTitle = `E2E Task ${ts}`;
    const taskDesc = `Automated test description ${ts}`;
    await createTask(page, taskTitle, taskDesc);
    await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible();
    await expect(page.getByText(taskDesc).first()).toBeVisible();
  });

  test('create task dialog opens and closes', async ({ page }) => {
    await openCreateDialog(page);
    await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();

    // Cancel should close dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('What needs to be done?')).not.toBeVisible({ timeout: 2_000 });
  });

  test('create task requires title', async ({ page }) => {
    await openCreateDialog(page);
    const createButton = page.getByRole('button', { name: 'Create Task' });
    await expect(createButton).toBeDisabled();

    await page.getByPlaceholder('What needs to be done?').fill('Valid Task');
    await expect(createButton).toBeEnabled();
  });

  test('click task to open agent panel', async ({ page }) => {
    const taskTitle = `Panel Task ${Date.now()}`;
    await createTask(page, taskTitle);

    // Click the task card
    await page.getByRole('heading', { name: taskTitle }).click();

    // Agent panel should open with task title and action buttons
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
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('edit button opens dialog with pre-populated data', async ({ page }) => {
    const ts = Date.now();
    const taskTitle = `Editable Task ${ts}`;
    await createTask(page, taskTitle, 'Original description');

    // Find the card containing our task and hover to reveal the edit button
    const taskCard = page.locator('.group').filter({ has: page.getByRole('heading', { name: taskTitle }) });
    await taskCard.hover();

    // Click the edit button (pencil icon) within this specific card
    const editButton = taskCard.getByRole('button', { name: 'Edit task' });
    await editButton.click();

    // Dialog should open in edit mode
    await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible();

    // Fields should be pre-populated
    const titleInput = page.getByPlaceholder('What needs to be done?');
    await expect(titleInput).toHaveValue(taskTitle);
    await expect(page.getByPlaceholder('Describe the task for the Copilot agent...')).toHaveValue('Original description');

    // Edit the title
    const newTitle = `Edited Task ${ts}`;
    await titleInput.fill(newTitle);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Dialog should close and updated title should appear
    await expect(page.getByRole('heading', { name: 'Edit Task' })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('heading', { name: newTitle })).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Priority Selection', () => {
  test('can select different priorities in task dialog', async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);

    await openCreateDialog(page);

    // Click priority dropdown button (the one in the dialog with role=button and name=Medium)
    await page.getByRole('button', { name: 'Medium' }).click();

    // Should show all priority options in the dropdown
    const dropdown = page.locator('.absolute');
    await expect(dropdown.getByText('Low')).toBeVisible();
    await expect(dropdown.getByText('High')).toBeVisible();
    await expect(dropdown.getByText('Critical')).toBeVisible();

    // Select High
    await dropdown.getByText('High').click();

    // Fill and submit
    const taskTitle = `High Priority ${Date.now()}`;
    await page.getByPlaceholder('What needs to be done?').fill(taskTitle);
    await page.getByRole('button', { name: 'Create Task' }).click();

    // Task should appear with High priority badge
    await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible({ timeout: 5_000 });
  });
});
