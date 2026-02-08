import Database from 'better-sqlite3';
import type { Task, Priority, ColumnId, AgentStatus } from '../types.js';
import type { TaskRepository } from './types.js';

interface TaskRow {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  column_id: ColumnId;
  agent_status: AgentStatus;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    columnId: row.column_id,
    agentStatus: row.agent_status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

export class SqliteTaskRepository implements TaskRepository {
  private stmts: {
    getAll: Database.Statement;
    getById: Database.Statement;
    insert: Database.Statement;
    update: Database.Statement;
    delete: Database.Statement;
    count: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.stmts = {
      getAll: db.prepare('SELECT * FROM tasks ORDER BY created_at ASC'),
      getById: db.prepare('SELECT * FROM tasks WHERE id = ?'),
      insert: db.prepare(`
        INSERT INTO tasks (id, title, description, priority, column_id, agent_status, created_at, started_at, completed_at)
        VALUES (@id, @title, @description, @priority, @column_id, @agent_status, @created_at, @started_at, @completed_at)
      `),
      update: db.prepare(`
        UPDATE tasks SET
          title = @title,
          description = @description,
          priority = @priority,
          column_id = @column_id,
          agent_status = @agent_status,
          started_at = @started_at,
          completed_at = @completed_at
        WHERE id = @id
      `),
      delete: db.prepare('DELETE FROM tasks WHERE id = ?'),
      count: db.prepare('SELECT COUNT(*) as cnt FROM tasks'),
    };
  }

  getAll(): Task[] {
    return (this.stmts.getAll.all() as TaskRow[]).map(rowToTask);
  }

  getById(id: string): Task | undefined {
    const row = this.stmts.getById.get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  create(task: Task): Task {
    this.stmts.insert.run({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      column_id: task.columnId,
      agent_status: task.agentStatus,
      created_at: task.createdAt,
      started_at: task.startedAt ?? null,
      completed_at: task.completedAt ?? null,
    });
    return task;
  }

  update(id: string, updates: Partial<Task>): Task | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...updates };
    this.stmts.update.run({
      id,
      title: merged.title,
      description: merged.description,
      priority: merged.priority,
      column_id: merged.columnId,
      agent_status: merged.agentStatus,
      started_at: merged.startedAt ?? null,
      completed_at: merged.completedAt ?? null,
    });
    return merged;
  }

  delete(id: string): boolean {
    const result = this.stmts.delete.run(id);
    return result.changes > 0;
  }

  count(): number {
    const row = this.stmts.count.get() as { cnt: number };
    return row.cnt;
  }
}
