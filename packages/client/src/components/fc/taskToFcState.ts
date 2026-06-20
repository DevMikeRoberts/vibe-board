// taskToFcState.ts — map an AI Agent Board task to one of the 8 fc card states.
//
// AI Agent Board gives us two live signals per task: the kanban column
// (`columnId`) and the agent run status (`agentStatus`). The agent status is
// the most informative thing to surface, so active/failed states win over the
// resting column states — mirroring the original card-states priority order
// (fail > done > working > resting > idle). See components/fc/ for the visuals.

import type { Task } from '@/types';
import type { FcState } from './fcState';

export function taskToFcState(
  task: Pick<Task, 'columnId' | 'agentStatus'>,
  needsInput = false
): FcState {
  // 0) Human attention beats everything — an agent is blocked waiting on you.
  if (needsInput) return 'needs';

  // 1) Hard failure is next — this is what a human most needs to see.
  if (task.agentStatus === 'failed') return 'fail';

  // 2) Shipped.
  if (task.columnId === 'done') return 'done';

  // 3) An agent is actively working right now.
  if (task.agentStatus === 'executing') return 'build';
  if (task.agentStatus === 'planning') return 'groom';

  // 4) Resting column states.
  if (task.columnId === 'review') return 'review';
  if (task.columnId === 'in-progress') return 'ready';

  // 5) Nothing happening (backlog / idle).
  return 'idle';
}
