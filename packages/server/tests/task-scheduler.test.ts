import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Task, ProjectConfig } from '../src/types.js';
import type { TaskRepository } from '../src/repositories/types.js';
import type { ProjectRepository } from '../src/repositories/project-types.js';
import type { AgentManager, TaskSettledHandler, TaskSettledInfo } from '../src/services/agent-manager.js';
import { TaskScheduler } from '../src/services/task-scheduler.js';

const tick = () => new Promise((r) => setTimeout(r, 10));

function task(over: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: over.id,
    description: '',
    priority: 'medium',
    columnId: 'backlog',
    agentStatus: 'idle',
    createdAt: Date.now(),
    projectId: 'default',
    ...over,
  } as Task;
}

function makeRepo(initial: Task[]) {
  const map = new Map(initial.map((t) => [t.id, t]));
  const repo = {
    map,
    async getById(id: string) { return map.get(id); },
    async update(id: string, updates: Partial<Task>) {
      const ex = map.get(id);
      if (!ex) return undefined;
      const merged = { ...ex, ...updates };
      map.set(id, merged);
      return merged;
    },
    async getAll(_inc = false, projectId = 'default') {
      return [...map.values()].filter(
        (t) => (t.projectId ?? 'default') === projectId && !t.archived && !t.groupId,
      );
    },
    async insertEvent() { /* noop */ },
  };
  return repo;
}

function makeAgent() {
  const running = new Set<string>();
  const started: Task[] = [];
  let handler: TaskSettledHandler | null = null;
  let available = true;
  const agent = {
    started,
    setAvailable(v: boolean) { available = v; },
    setRunning(id: string, v: boolean) { v ? running.add(id) : running.delete(id); },
    fireSettled(info: TaskSettledInfo) { handler?.(info); },
    // AgentManager surface used by the scheduler:
    setTaskSettledHandler(h: TaskSettledHandler | null) { handler = h; },
    isRunning(id: string) { return running.has(id); },
    resetEvents() { /* noop */ },
    getAvailableAgents() { return [{ name: 'claude', displayName: 'Claude', available }]; },
    async getEvents() { return []; },
    startAgent(t: Task) { started.push(t); running.add(t.id); },
  };
  return agent;
}

const projectRepo = {
  async getAllWithCounts() { return [{ id: 'default' }]; },
} as unknown as ProjectRepository;

function makeScheduler(repo: ReturnType<typeof makeRepo>, agent: ReturnType<typeof makeAgent>, settings: ProjectConfig) {
  return new TaskScheduler(
    repo as unknown as TaskRepository,
    agent as unknown as AgentManager,
    projectRepo,
    () => settings,
  );
}

test('schedules a retry when a failed task hit a token limit', async () => {
  const repo = makeRepo([task({ id: 't1', columnId: 'in-progress', agentStatus: 'failed' })]);
  const agent = makeAgent();
  const settings: ProjectConfig = { cloneRoot: '/tmp', tokenLimitRetryEnabled: true, autoPickupEnabled: false };
  const sched = makeScheduler(repo, agent, settings);
  await sched.start();

  const now = Date.now();
  agent.fireSettled({ taskId: 't1', status: 'failed', error: 'rate limit reached, retry-after: 3600', agentType: 'claude' });
  await tick();

  const t1 = repo.map.get('t1')!;
  assert.ok(t1.retryAt && t1.retryAt > now + 59 * 60_000 && t1.retryAt < now + 61 * 60_000, `retryAt ~1h: ${t1.retryAt}`);
  assert.equal(sched.cancelRetry('t1'), true, 'a retry timer should be registered');
  sched.stop();
});

test('does not retry a non-limit failure', async () => {
  const repo = makeRepo([task({ id: 't1', columnId: 'in-progress', agentStatus: 'failed' })]);
  const agent = makeAgent();
  const settings: ProjectConfig = { cloneRoot: '/tmp', tokenLimitRetryEnabled: true, autoPickupEnabled: false };
  const sched = makeScheduler(repo, agent, settings);
  await sched.start();

  agent.fireSettled({ taskId: 't1', status: 'failed', error: 'spawn claude ENOENT', agentType: 'claude' });
  await tick();

  assert.equal(repo.map.get('t1')!.retryAt, undefined);
  assert.equal(sched.cancelRetry('t1'), false);
  sched.stop();
});

test('auto-pickup starts one backlog task at a time, highest priority first', async () => {
  const repo = makeRepo([
    task({ id: 'low', priority: 'low', createdAt: 1 }),
    task({ id: 'high', priority: 'high', createdAt: 2 }),
  ]);
  const agent = makeAgent();
  const settings: ProjectConfig = { cloneRoot: '/tmp', autoPickupEnabled: true };
  const sched = makeScheduler(repo, agent, settings);

  sched.notifyTaskChanged('default');
  await tick();
  assert.deepEqual(agent.started.map((t) => t.id), ['high'], 'highest priority picked first');
  assert.equal(repo.map.get('high')!.columnId, 'in-progress');

  // 'high' is running → project is busy → no second pickup.
  sched.notifyTaskChanged('default');
  await tick();
  assert.equal(agent.started.length, 1, 'one at a time while a task is running');

  // 'high' finishes → next backlog task is picked.
  agent.setRunning('high', false);
  await repo.update('high', { columnId: 'review', agentStatus: 'complete' });
  sched.notifyTaskChanged('default');
  await tick();
  assert.deepEqual(agent.started.map((t) => t.id), ['high', 'low'], 'next task picked after completion');
  sched.stop();
});

test('auto-pickup respects the disabled flag and the available-agent gate', async () => {
  const repo = makeRepo([task({ id: 'b1' })]);
  const agent = makeAgent();
  const settings: ProjectConfig = { cloneRoot: '/tmp', autoPickupEnabled: false };
  const sched = makeScheduler(repo, agent, settings);

  sched.notifyTaskChanged('default');
  await tick();
  assert.equal(agent.started.length, 0, 'nothing starts while disabled');

  settings.autoPickupEnabled = true;
  agent.setAvailable(false);
  sched.notifyTaskChanged('default');
  await tick();
  assert.equal(agent.started.length, 0, 'nothing starts with no available agent');

  agent.setAvailable(true);
  sched.notifyTaskChanged('default');
  await tick();
  assert.deepEqual(agent.started.map((t) => t.id), ['b1']);
  sched.stop();
});
