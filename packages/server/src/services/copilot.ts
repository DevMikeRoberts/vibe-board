/**
 * Backward-compatibility shim — delegates to AgentManager.
 *
 * New code should import from AgentManager directly.
 * This file exists so any external consumers that imported
 * from './copilot.js' continue to work during the transition.
 */

import type { Task, AgentEvent } from '../types.js';
import type { TaskRepository } from '../repositories/types.js';
import { AgentManager } from './agent-manager.js';

// Singleton AgentManager instance shared across the app
let _manager: AgentManager | null = null;

/** Set the shared AgentManager instance (called from index.ts). */
export function setAgentManager(manager: AgentManager): void {
  _manager = manager;
}

function mgr(): AgentManager {
  if (!_manager) throw new Error('AgentManager not initialized — call setAgentManager() first');
  return _manager;
}

export function initEventPersistence(repo: TaskRepository): void {
  mgr().initEventPersistence(repo);
}

export function startAgent(
  task: Task,
  onStatusChange: (status: Task['agentStatus']) => void,
  onWorktreeCreated?: (worktreePath: string) => void,
): void {
  mgr().startAgent(task, onStatusChange, onWorktreeCreated);
}

export function stopAgent(taskId: string): boolean {
  return mgr().stopAgent(taskId);
}

export function isRunning(taskId: string): boolean {
  return mgr().isRunning(taskId);
}

export function getEvents(taskId: string): AgentEvent[] {
  return mgr().getEvents(taskId);
}

export function clearEvents(taskId: string): void {
  mgr().clearEvents(taskId);
}

export function shutdownAll(): void {
  mgr().shutdownAll();
}

export function createPR(task: Task): { url: string } {
  return mgr().createPR(task);
}

export function removeWorktree(task: Task): void {
  mgr().removeWorktree(task);
}
