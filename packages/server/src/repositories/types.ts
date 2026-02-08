import type { Task } from '../types.js';

export interface TaskRepository {
  getAll(): Task[];
  getById(id: string): Task | undefined;
  create(task: Task): Task;
  update(id: string, updates: Partial<Task>): Task | undefined;
  delete(id: string): boolean;
  count(): number;
}
