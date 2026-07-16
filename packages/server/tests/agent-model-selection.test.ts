import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentManager } from '../src/services/agent-manager.js';
import type { Task } from '../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    description: '',
    priority: 'medium',
    columnId: 'backlog',
    agentStatus: 'idle',
    createdAt: Date.now(),
    projectId: 'proj-1',
    ...overrides,
  };
}

test('getProviderForTask returns the shared provider when no per-task model is set', () => {
  const manager = new AgentManager();
  const sharedProvider = {
    name: 'claude', displayName: 'Claude Code', model: 'configured default',
    start: async () => {}, stop: async () => {},
    createSession: async () => { throw new Error('unused in this test'); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manager as any).providers.set('claude', sharedProvider);

  const task = makeTask({ agentType: 'claude' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = (manager as any).getProviderForTask('claude', task);
  assert.equal(provider, sharedProvider);
});

test('getProviderForTask returns a dedicated provider configured for a per-task model override', () => {
  const manager = new AgentManager();
  const task = makeTask({ agentType: 'claude', model: 'opus' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = (manager as any).getProviderForTask('claude', task);
  assert.equal(provider.model, 'opus');
});

test('getProviderForTask reuses the cached provider across tasks sharing the same model', () => {
  const manager = new AgentManager();
  const taskA = makeTask({ id: 'a', agentType: 'claude', model: 'opus' });
  const taskB = makeTask({ id: 'b', agentType: 'claude', model: 'opus' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerA = (manager as any).getProviderForTask('claude', taskA);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerB = (manager as any).getProviderForTask('claude', taskB);
  assert.equal(providerA, providerB);
});

test('getProviderForTask creates distinct providers for different model overrides', () => {
  const manager = new AgentManager();
  const taskOpus = makeTask({ id: 'a', agentType: 'claude', model: 'opus' });
  const taskHaiku = makeTask({ id: 'b', agentType: 'claude', model: 'haiku' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerOpus = (manager as any).getProviderForTask('claude', taskOpus);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerHaiku = (manager as any).getProviderForTask('claude', taskHaiku);
  assert.notEqual(providerOpus, providerHaiku);
  assert.equal(providerOpus.model, 'opus');
  assert.equal(providerHaiku.model, 'haiku');
});

test('getProviderForTask ignores model override for non-claude agents', () => {
  const manager = new AgentManager();
  const sharedProvider = {
    name: 'opencode', displayName: 'OpenCode', model: 'configured default',
    start: async () => {}, stop: async () => {},
    createSession: async () => { throw new Error('unused in this test'); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (manager as any).providers.set('opencode', sharedProvider);

  const task = makeTask({ agentType: 'opencode', model: 'qwen3:4B' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = (manager as any).getProviderForTask('opencode', task);
  assert.equal(provider, sharedProvider);
});
