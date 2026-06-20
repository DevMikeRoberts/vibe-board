// useNeedsInput.ts — tracks which tasks have an agent waiting on human input.
//
// `agent_follow_up` is a transient WebSocket event (the agent asked a question and
// is now blocked), not a persisted task field — so we keep a tiny shared store fed
// by the same WS singleton the rest of the app uses. A task is "awaiting input"
// from the moment it asks until the agent resumes (next `agent_event`) or the task
// reaches a terminal state. Cards read it by id via useSyncExternalStore, so there
// is exactly one WS listener and no prop-drilling.

import { useSyncExternalStore } from 'react';
import { connectWS } from '@/lib/api';

const awaiting = new Set<string>();
const subscribers = new Set<() => void>();
let started = false;

function emit() {
  for (const fn of subscribers) fn();
}
function add(id: string) {
  if (!awaiting.has(id)) {
    awaiting.add(id);
    emit();
  }
}
function remove(id: string) {
  if (awaiting.delete(id)) emit();
}

function start() {
  if (started) return;
  started = true;
  connectWS((msg) => {
    switch (msg.type) {
      case 'agent_follow_up':
        add(msg.payload.taskId);
        break;
      // The agent went quiet after asking; the first event once it resumes — or any
      // completion — means it is no longer waiting on the human.
      case 'agent_event':
      case 'agent_complete':
        remove(msg.payload.taskId);
        break;
      case 'task_updated':
        if (
          msg.payload.agentStatus === 'complete' ||
          msg.payload.agentStatus === 'failed'
        ) {
          remove(msg.payload.id);
        }
        break;
      case 'task_deleted':
        remove(msg.payload.id);
        break;
    }
  });

  // Dev-only seam so the WS-driven "needs you" state can be exercised without a
  // live agent run (e.g. window.__fcNeedsInput.add(taskId)). Stripped from prod builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__fcNeedsInput = { add, remove };
  }
}

/** True when the given task has an agent waiting on the human. */
export function useNeedsInput(taskId: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      start();
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    () => awaiting.has(taskId),
    () => false
  );
}
