import Database from 'better-sqlite3';
import type { TaskAttachment } from '../types.js';
import type { AttachmentStore } from './attachment-types.js';

interface AttachmentRow {
  id: string;
  task_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: number;
}

function rowToAttachment(row: AttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

export class SqliteAttachmentStore implements AttachmentStore {
  private stmts: {
    insert: Database.Statement;
    getByTaskId: Database.Statement;
    getById: Database.Statement;
    deleteById: Database.Statement;
    countByTaskId: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.stmts = {
      insert: db.prepare(`
        INSERT INTO task_attachments (id, task_id, filename, original_name, mime_type, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getByTaskId: db.prepare(
        `SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC`
      ),
      getById: db.prepare(`SELECT * FROM task_attachments WHERE id = ?`),
      deleteById: db.prepare(`DELETE FROM task_attachments WHERE id = ?`),
      countByTaskId: db.prepare(`SELECT COUNT(*) as cnt FROM task_attachments WHERE task_id = ?`),
    };
  }

  async insert(a: TaskAttachment): Promise<void> {
    this.stmts.insert.run(a.id, a.taskId, a.filename, a.originalName, a.mimeType, a.size, a.createdAt);
  }

  async getByTaskId(taskId: string): Promise<TaskAttachment[]> {
    const rows = this.stmts.getByTaskId.all(taskId) as AttachmentRow[];
    return rows.map(rowToAttachment);
  }

  async getById(id: string): Promise<TaskAttachment | undefined> {
    const row = this.stmts.getById.get(id) as AttachmentRow | undefined;
    return row ? rowToAttachment(row) : undefined;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = this.stmts.deleteById.run(id);
    return result.changes > 0;
  }

  async countByTaskId(taskId: string): Promise<number> {
    const row = this.stmts.countByTaskId.get(taskId) as { cnt: number };
    return row.cnt;
  }
}
