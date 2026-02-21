import type { Task, AgentEvent } from '../types.js';

export interface TaskRepository {
  getAll(includeArchived?: boolean): Promise<Task[]>;
  getById(id: string): Promise<Task | undefined>;
  create(task: Task): Promise<Task>;
  update(id: string, updates: Partial<Task>): Promise<Task | undefined>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  insertEvent(event: AgentEvent): Promise<void>;
  getEventsByTaskId(taskId: string): Promise<AgentEvent[]>;
  deleteEventsByTaskId(taskId: string): Promise<void>;
  getArchivedTasks(): Promise<Task[]>;
}
