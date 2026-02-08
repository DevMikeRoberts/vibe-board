import { v4 as uuid } from 'uuid';
import type { Task, AgentEvent } from '../types.js';
import { broadcast } from '../websocket.js';

// Active agent sessions keyed by taskId
const sessions = new Map<string, { cancel: () => void }>();

// Event log per task (capped to prevent unbounded growth)
const MAX_EVENTS_PER_TASK = 100;
const eventLogs = new Map<string, AgentEvent[]>();

// Simulated agent steps (used when Copilot SDK is not available)
const simulatedSteps: Omit<AgentEvent, 'id' | 'taskId' | 'timestamp'>[] = [
  {
    type: 'thinking',
    content: 'Analyzing the task requirements and planning implementation approach...',
  },
  {
    type: 'thinking',
    content: 'Breaking down into sub-tasks:\n1. Identify affected files\n2. Implement changes\n3. Run tests\n4. Verify output',
  },
  {
    type: 'command',
    content: 'find . -name "*.ts" | head -20',
    metadata: { command: 'find . -name "*.ts" | head -20' },
  },
  {
    type: 'output',
    content: './src/index.ts\n./src/routes/tasks.ts\n./src/services/copilot.ts',
  },
  {
    type: 'file_edit',
    content: 'Implementing the requested changes',
    metadata: {
      file: 'src/implementation.ts',
      language: 'typescript',
      diff: `+import { Service } from './service';
+
+export class Implementation {
+  private service: Service;
+
+  constructor() {
+    this.service = new Service();
+  }
+
+  async execute(): Promise<void> {
+    await this.service.run();
+  }
+}`,
    },
  },
  {
    type: 'command',
    content: 'npx tsc --noEmit',
    metadata: { command: 'npx tsc --noEmit' },
  },
  {
    type: 'output',
    content: '✓ No type errors found',
  },
  {
    type: 'complete',
    content: 'Task implementation complete. All changes have been applied and verified.',
  },
];

function emitEvent(taskId: string, event: AgentEvent): void {
  let log = eventLogs.get(taskId) || [];
  log.push(event);
  if (log.length > MAX_EVENTS_PER_TASK) {
    log = log.slice(-MAX_EVENTS_PER_TASK);
  }
  eventLogs.set(taskId, log);
  broadcast({ type: 'agent_event', payload: event });
}

export function getEvents(taskId: string): AgentEvent[] {
  return eventLogs.get(taskId) || [];
}

export function startAgent(
  task: Task,
  onStatusChange: (status: Task['agentStatus']) => void
): void {
  if (sessions.has(task.id)) return;

  let cancelled = false;
  let stepIndex = 0;
  let timer: ReturnType<typeof setTimeout>;

  const runStep = () => {
    if (cancelled || stepIndex >= simulatedSteps.length) return;

    const step = simulatedSteps[stepIndex];
    const event: AgentEvent = {
      ...step,
      id: uuid(),
      taskId: task.id,
      timestamp: Date.now(),
    };

    // Update status based on step
    if (stepIndex === 0) onStatusChange('planning');
    if (stepIndex === 2) onStatusChange('executing');

    emitEvent(task.id, event);
    stepIndex++;

    if (step.type === 'complete') {
      onStatusChange('complete');
      sessions.delete(task.id);
      return;
    }

    timer = setTimeout(runStep, 1000 + Math.random() * 2000);
  };

  sessions.set(task.id, {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
    },
  });

  // Start after a brief delay
  timer = setTimeout(runStep, 500);
}

export function stopAgent(taskId: string): boolean {
  const session = sessions.get(taskId);
  if (!session) return false;
  session.cancel();
  sessions.delete(taskId);

  const event: AgentEvent = {
    id: uuid(),
    taskId,
    type: 'error',
    content: 'Agent stopped by user.',
    timestamp: Date.now(),
  };
  emitEvent(taskId, event);
  return true;
}

export function isRunning(taskId: string): boolean {
  return sessions.has(taskId);
}

export function clearEvents(taskId: string): void {
  eventLogs.delete(taskId);
}
