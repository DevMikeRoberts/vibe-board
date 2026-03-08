import { test, expect } from '@playwright/test';
import { API, createTaskViaAPI, deleteTaskViaAPI } from './helpers';

test.describe('Task Archive/Unarchive', () => {
  let createdIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdIds) {
      await deleteTaskViaAPI(request, id);
    }
    createdIds = [];
  });

  test('PATCH /api/tasks/:id/archive archives a completed task', async ({ request }) => {
    // Create a task and move it to done
    const task = await createTaskViaAPI(request, { title: 'Archivable Task' });
    createdIds.push(task.id);

    // Move to in-progress, then review, then done
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'in-progress' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'review' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'done' } });

    const res = await request.patch(`${API}/api/tasks/${task.id}/archive`);
    expect(res.status()).toBe(200);
    const archived = await res.json();
    expect(archived.archived).toBe(true);
  });

  test('PATCH /api/tasks/:id/archive rejects non-completed task', async ({ request }) => {
    const task = await createTaskViaAPI(request, { title: 'Backlog Task' });
    createdIds.push(task.id);

    const res = await request.patch(`${API}/api/tasks/${task.id}/archive`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('completed or failed');
  });

  test('PATCH /api/tasks/:id/archive returns 404 for unknown task', async ({ request }) => {
    const res = await request.patch(`${API}/api/tasks/nonexistent-id/archive`);
    expect(res.status()).toBe(404);
  });

  test('PATCH /api/tasks/:id/unarchive restores an archived task', async ({ request }) => {
    const task = await createTaskViaAPI(request, { title: 'Unarchive Test' });
    createdIds.push(task.id);

    // Move to done and archive
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'in-progress' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'review' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'done' } });
    await request.patch(`${API}/api/tasks/${task.id}/archive`);

    const res = await request.patch(`${API}/api/tasks/${task.id}/unarchive`);
    expect(res.status()).toBe(200);
    const unarchived = await res.json();
    expect(unarchived.archived).toBe(false);
  });

  test('PATCH /api/tasks/:id/unarchive rejects non-archived task', async ({ request }) => {
    const task = await createTaskViaAPI(request, { title: 'Not Archived' });
    createdIds.push(task.id);

    // Move to done but don't archive
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'in-progress' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'review' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'done' } });

    const res = await request.patch(`${API}/api/tasks/${task.id}/unarchive`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not archived');
  });

  test('GET /api/tasks excludes archived tasks by default', async ({ request }) => {
    const task = await createTaskViaAPI(request, { title: 'Hidden After Archive' });
    createdIds.push(task.id);

    // Move to done and archive
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'in-progress' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'review' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'done' } });
    await request.patch(`${API}/api/tasks/${task.id}/archive`);

    const listRes = await request.get(`${API}/api/tasks`);
    const tasks = await listRes.json();
    const ids = tasks.map((t: any) => t.id);
    expect(ids).not.toContain(task.id);
  });

  test('GET /api/tasks?includeArchived=true includes archived tasks', async ({ request }) => {
    const task = await createTaskViaAPI(request, { title: 'Visible With Flag' });
    createdIds.push(task.id);

    // Move to done and archive
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'in-progress' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'review' } });
    await request.patch(`${API}/api/tasks/${task.id}`, { data: { columnId: 'done' } });
    await request.patch(`${API}/api/tasks/${task.id}/archive`);

    const listRes = await request.get(`${API}/api/tasks?includeArchived=true`);
    const tasks = await listRes.json();
    const found = tasks.find((t: any) => t.id === task.id);
    expect(found).toBeTruthy();
    expect(found.archived).toBe(true);
  });
});
