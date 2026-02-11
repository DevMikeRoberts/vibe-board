import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (mirrors board.spec.ts patterns)
// ---------------------------------------------------------------------------

async function waitForBoard(page: Page) {
  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
}

async function openCreateDialog(page: Page) {
  const backlogHeading = page.getByRole('heading', { name: 'Backlog' });
  const headerRow = backlogHeading.locator('..').locator('..');
  const addButton = headerRow.locator('button').first();
  await addButton.click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).toBeVisible();
}

async function createTask(page: Page, title: string, description = 'Test description') {
  await openCreateDialog(page);
  await page.getByPlaceholder('What needs to be done?').fill(title);
  await page.getByPlaceholder('Describe the task for the Copilot agent...').fill(description);
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByRole('heading', { name: 'Create Task' })).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
}

/** Create a task and move it to in-progress via API, then reload. Returns the task id. */
async function createTaskInProgress(page: Page, title: string, opts?: { agentType?: string }) {
  await createTask(page, title);

  const taskId = await page.evaluate(async (t) => {
    const res = await fetch('/api/tasks');
    const tasks = await res.json();
    return tasks.find((tk: any) => tk.title === t)?.id;
  }, title);

  // Move to in-progress (and optionally set agentType)
  const patchBody: Record<string, string> = { columnId: 'in-progress' };
  if (opts?.agentType) patchBody.agentType = opts.agentType;

  await page.evaluate(async ({ id, body }) => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, { id: taskId, body: patchBody });

  await page.reload();
  await waitForBoard(page);
  return taskId as string;
}

/** Open the WorktreeDialog for an in-progress task. Returns the dialog locator. */
async function openWorktreeDialog(page: Page, title: string) {
  await page.getByRole('heading', { name: title }).click();
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeVisible({ timeout: 3_000 });
  await page.getByRole('button', { name: 'Run agent' }).click();
  await expect(page.getByText('Configure Agent Run')).toBeVisible({ timeout: 3_000 });
  return page.locator('[role="dialog"]');
}

/**
 * Get the 3 agent buttons from the WorktreeDialog's grid.
 * Buttons are rendered in a grid-cols-3 div under the "Agent" label.
 * Display names: "Copilot" | "Code" (from "Claude Code") | "Codex"
 */
function getAgentButtons(dialog: ReturnType<Page['locator']>) {
  const grid = dialog.locator('.grid');
  return {
    copilot: grid.locator('button').nth(0),
    claude: grid.locator('button').nth(1),
    codex: grid.locator('button').nth(2),
  };
}

// ---------------------------------------------------------------------------
// Tests – WorktreeDialog agent selector
// ---------------------------------------------------------------------------

test.describe('Agent Selector in WorktreeDialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('shows agent selector with 3 agent buttons (Copilot, Claude, Codex)', async ({ page }) => {
    const title = `AgentSel ${Date.now()}`;
    await createTaskInProgress(page, title);
    const dialog = await openWorktreeDialog(page, title);

    // The grid should contain exactly 3 agent buttons
    const { copilot, claude, codex } = getAgentButtons(dialog);
    await expect(copilot).toBeVisible();
    await expect(claude).toBeVisible();
    await expect(codex).toBeVisible();

    // Verify button labels — displayName.split(' ').pop() gives: Copilot, Code, Codex
    await expect(copilot).toContainText('Copilot');
    await expect(claude).toContainText('Code');
    await expect(codex).toContainText('Codex');
  });

  test('clicking an agent button selects it (shows primary/active state)', async ({ page }) => {
    const title = `AgentClick ${Date.now()}`;
    await createTaskInProgress(page, title);
    const dialog = await openWorktreeDialog(page, title);
    const { copilot, claude, codex } = getAgentButtons(dialog);

    // Copilot should be selected by default (has border-primary class)
    await expect(copilot).toHaveClass(/border-primary/);

    // Try to click an available non-copilot agent to test selection switching
    const claudeDisabled = await claude.isDisabled();
    const codexDisabled = await codex.isDisabled();

    if (!claudeDisabled) {
      await claude.click();
      await expect(claude).toHaveClass(/border-primary/);
      // Copilot should no longer be the active one
      await expect(copilot).not.toHaveClass(/bg-primary\/10/);
    } else if (!codexDisabled) {
      await codex.click();
      await expect(codex).toHaveClass(/border-primary/);
      await expect(copilot).not.toHaveClass(/bg-primary\/10/);
    } else {
      // Both are disabled — verify copilot stays selected
      await expect(copilot).toHaveClass(/border-primary/);
    }
  });

  test('disabled agents have cursor-not-allowed styling', async ({ page }) => {
    const title = `AgentDisabled ${Date.now()}`;
    await createTaskInProgress(page, title);
    const dialog = await openWorktreeDialog(page, title);
    const { copilot, claude, codex } = getAgentButtons(dialog);

    // Check each agent button — unavailable ones should be disabled with cursor-not-allowed
    for (const [, btn] of [['copilot', copilot], ['claude', claude], ['codex', codex]] as const) {
      const isDisabled = await btn.isDisabled();
      if (isDisabled) {
        await expect(btn).toHaveClass(/cursor-not-allowed/);
      } else {
        await expect(btn).not.toHaveClass(/cursor-not-allowed/);
      }
    }
  });

  test('default agent selection is copilot', async ({ page }) => {
    const title = `DefaultAgent ${Date.now()}`;
    await createTaskInProgress(page, title);
    const dialog = await openWorktreeDialog(page, title);
    const { copilot } = getAgentButtons(dialog);

    // Copilot should be selected (primary border + bg)
    await expect(copilot).toHaveClass(/border-primary/);
    await expect(copilot).toHaveClass(/bg-primary/);
  });
});

// ---------------------------------------------------------------------------
// Tests – Agent type badge on task cards
// ---------------------------------------------------------------------------

test.describe('Agent Type Badge on Task Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('agent type badge appears on task card when agentType is set and column is not backlog', async ({ page }) => {
    const title = `BadgeTask ${Date.now()}`;
    await createTaskInProgress(page, title, { agentType: 'copilot' });

    // The card in in-progress should show the Copilot agent badge
    const card = page.locator('.group').filter({ has: page.getByRole('heading', { name: title }) });
    await expect(card.getByText('Copilot')).toBeVisible();
  });

  test('agent type badge does NOT appear on backlog cards', async ({ page }) => {
    const title = `NoBadge ${Date.now()}`;
    await createTask(page, title);

    // Set agentType via API but keep in backlog
    const taskId = await page.evaluate(async (t) => {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();
      return tasks.find((tk: any) => tk.title === t)?.id;
    }, title);

    await page.evaluate(async ({ id }) => {
      await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType: 'claude' }),
      });
    }, { id: taskId });

    await page.reload();
    await waitForBoard(page);

    // The card should still be in backlog — verify it's visible
    const card = page.locator('.group').filter({ has: page.getByRole('heading', { name: title }) });
    await expect(card).toBeVisible();

    // The agent badge (emoji + label) should NOT be present on backlog cards
    // TaskCard renders: agentBadgeMap[task.agentType].emoji + " " + agentBadgeMap[task.agentType].label
    // Only shown when task.columnId !== 'backlog'
    const agentBadge = card.locator('span').filter({ hasText: /^.+\s(Copilot|Claude|Codex)$/ });
    await expect(agentBadge).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Tests – Agent Panel header shows agent type
// ---------------------------------------------------------------------------

test.describe('Agent Panel Header', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForBoard(page);
  });

  test('shows the agent type emoji and label when task has agentType', async ({ page }) => {
    const title = `PanelAgent ${Date.now()}`;
    await createTaskInProgress(page, title, { agentType: 'copilot' });

    // Click to open the agent panel
    await page.getByRole('heading', { name: title }).click();
    await expect(page.getByRole('button', { name: 'Run agent' })).toBeVisible({ timeout: 3_000 });

    // The panel header should display "⚙️ Copilot" via agentDisplayMap
    await expect(page.getByText('Copilot').first()).toBeVisible();
  });
});
