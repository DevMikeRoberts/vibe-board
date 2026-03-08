import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API = 'http://localhost:3002';

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
