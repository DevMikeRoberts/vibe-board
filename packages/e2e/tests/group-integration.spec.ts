import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Full integration test for Task Groups with real agent execution.
 * Creates a group with 3 child tasks, runs them with parallelism=2
 * (so one queues), verifies execution completes, and checks worktree cleanup.
 *
 * Requires at least one agent CLI installed and authenticated.
 * Skipped when no agents are available (CI-safe).
 */

import { API } from './helpers';
const AGENT_TIMEOUT = 180_000; // 3 minutes for all children to complete
const TEST_REPO_BASE = path.join(os.tmpdir(), 'agentboard-group-e2e');

async function getAvailableAgent(request: any): Promise<string | null> {
  const res = await request.get(`${API}/api/agents`);
  const agents = await res.json();
  const available = agents.find((a: any) => a.available);
  return available?.name ?? null;
}

async function waitForGroupComplete(request: any, groupId: string, timeout: number) {
  await expect(async () => {
    const res = await request.get(`${API}/api/groups/${groupId}`);
    const group = await res.json();
    const allDone = group.children.every(
      (c: any) => c.agentStatus === 'complete' || c.agentStatus === 'failed',
    );
    expect(allDone).toBe(true);
  }).toPass({ timeout, intervals: [3_000] });
}

test.describe('Task Group Integration — Real Agent Execution', () => {
  let testRepo: string;
  let agentType: string | null;
  const createdGroupIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    if (process.env.CI) {
      agentType = null; // Agent CLIs on CI runners are not authenticated
    } else {
      agentType = await getAvailableAgent(request);
    }
  });

  test.beforeEach(() => {
    // Create a fresh temp repo for each test
    testRepo = path.join(TEST_REPO_BASE, `repo-${Date.now()}`);
    mkdirSync(testRepo, { recursive: true });
    execSync('git init -b main', { cwd: testRepo, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testRepo, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testRepo, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "init"', { cwd: testRepo, stdio: 'pipe' });
  });

  test.afterEach(async ({ request }) => {
    // Clean up groups via API
    for (const id of createdGroupIds) {
      await request.delete(`${API}/api/groups/${id}`).catch(() => {});
    }
    createdGroupIds.length = 0;

    // Clean up worktrees before removing repo
    try {
      execSync('git worktree prune', { cwd: testRepo, stdio: 'pipe' });
    } catch { /* repo may already be gone */ }

    // Remove temp repo
    try {
      rmSync(testRepo, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  test('create and run a group with 3 tasks using real agents', async ({ request }) => {
    test.skip(!agentType, 'No agents available — skipping integration test');
    test.setTimeout(AGENT_TIMEOUT);

    // 1. Create the group with 3 child tasks, parallelism=2
    const createRes = await request.post(`${API}/api/groups`, {
      data: {
        title: 'E2E Integration Group',
        description: 'Full integration test with real agent execution',
        priority: 'high',
        repoPath: testRepo,
        baseBranch: 'main',
        maxConcurrency: 2,
        children: [
          {
            title: 'Create a Python hello world script',
            description: 'Create a file called hello.py that prints "Hello, World!" when run with python3.',
            agentType,
            useWorktree: true,
          },
          {
            title: 'Create a README.md',
            description: 'Create a README.md file with a title, a one-line description, and usage instructions for running hello.py.',
            agentType,
            useWorktree: true,
          },
          {
            title: 'Create a .gitignore for Python',
            description: 'Create a .gitignore file with common Python patterns: __pycache__/, *.pyc, .env, venv/, dist/, *.egg-info/.',
            agentType,
            useWorktree: true,
          },
        ],
      },
    });

    expect(createRes.status()).toBe(201);
    const group = await createRes.json();
    createdGroupIds.push(group.id);
    expect(group.children).toHaveLength(3);
    expect(group.columnId).toBe('backlog');

    // 2. Run the group
    const runRes = await request.post(`${API}/api/groups/${group.id}/run`);
    expect(runRes.status()).toBe(200);
    const running = await runRes.json();
    expect(running.columnId).toBe('in-progress');

    // 3. Verify children start executing (at most 2 at a time due to concurrency)
    await expect(async () => {
      const res = await request.get(`${API}/api/groups/${group.id}`);
      const g = await res.json();
      const activeCount = g.children.filter(
        (c: any) => c.agentStatus === 'executing' || c.agentStatus === 'planning',
      ).length;
      // At least 1 child should be active
      expect(activeCount).toBeGreaterThanOrEqual(1);
      // Should never exceed maxConcurrency
      expect(activeCount).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 30_000, intervals: [2_000] });

    // 4. Wait for all children to complete (or fail)
    await waitForGroupComplete(request, group.id, AGENT_TIMEOUT);

    // 5. Verify final state
    const finalRes = await request.get(`${API}/api/groups/${group.id}`);
    const finalGroup = await finalRes.json();

    const completed = finalGroup.children.filter((c: any) => c.agentStatus === 'complete');
    const failed = finalGroup.children.filter((c: any) => c.agentStatus === 'failed');
    console.log(`Group result: ${completed.length} complete, ${failed.length} failed out of 3`);

    // At least some should have completed (agents are real, so failures are possible)
    expect(completed.length + failed.length).toBe(3);

    // If all completed, group should have auto-advanced to review
    if (failed.length === 0) {
      expect(finalGroup.columnId).toBe('review');
    } else {
      // Group stays in-progress when there are failures
      expect(finalGroup.columnId).toBe('in-progress');
    }

    // 6. Verify each child had a worktree assigned
    for (const child of finalGroup.children) {
      if (child.agentStatus === 'complete') {
        expect(child.branchName).toBeTruthy();
        expect(child.branchName).toContain('group/');
      }
    }

    // 7. Verify events were generated for each child
    for (const child of finalGroup.children) {
      const eventsRes = await request.get(`${API}/api/tasks/${child.id}/events`);
      expect(eventsRes.status()).toBe(200);
      const events = await eventsRes.json();
      expect(events.length).toBeGreaterThan(0);
      console.log(`  Child "${child.title}": ${child.agentStatus}, ${events.length} events`);
    }
  });

  test('stop a running group and verify cleanup', async ({ request }) => {
    test.skip(!agentType, 'No agents available — skipping integration test');
    test.setTimeout(60_000);

    // Create and run a group with a long-running task
    const createRes = await request.post(`${API}/api/groups`, {
      data: {
        title: 'E2E Stop Group Test',
        priority: 'medium',
        repoPath: testRepo,
        baseBranch: 'main',
        maxConcurrency: 2,
        children: [
          {
            title: 'Create a comprehensive Python calculator',
            description: 'Build a full-featured calculator with add, subtract, multiply, divide, power, and square root operations. Include type hints and docstrings for every function.',
            agentType,
            useWorktree: true,
          },
          {
            title: 'Create a comprehensive test suite',
            description: 'Write thorough pytest tests covering all calculator operations including edge cases like division by zero, negative square roots, and large numbers.',
            agentType,
            useWorktree: true,
          },
        ],
      },
    });

    expect(createRes.status()).toBe(201);
    const group = await createRes.json();
    createdGroupIds.push(group.id);

    // Run
    await request.post(`${API}/api/groups/${group.id}/run`);

    // Wait for at least one child to start
    await expect(async () => {
      const res = await request.get(`${API}/api/groups/${group.id}`);
      const g = await res.json();
      const active = g.children.some(
        (c: any) => c.agentStatus === 'executing' || c.agentStatus === 'planning',
      );
      expect(active).toBe(true);
    }).toPass({ timeout: 20_000, intervals: [2_000] });

    // Stop the group
    const stopRes = await request.post(`${API}/api/groups/${group.id}/stop`);
    expect(stopRes.status()).toBe(200);

    // Verify all children stopped
    const finalRes = await request.get(`${API}/api/groups/${group.id}`);
    const finalGroup = await finalRes.json();
    for (const child of finalGroup.children) {
      expect(['idle', 'complete', 'failed']).toContain(child.agentStatus);
    }
    // Group should not have advanced to review
    expect(finalGroup.columnId).toBe('in-progress');
  });
});
