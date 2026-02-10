import type { Task, AgentEvent } from '../types.js';

export interface TaskRepository {
  getAll(): Task[];
  getById(id: string): Task | undefined;
  create(task: Task): Task;
  update(id: string, updates: Partial<Task>): Task | undefined;
  delete(id: string): boolean;
  count(): number;
  insertEvent(event: AgentEvent): void;
  getEventsByTaskId(taskId: string): AgentEvent[];
  deleteEventsByTaskId(taskId: string): void;
}
