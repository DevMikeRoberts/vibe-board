import { Pool } from 'pg';
import type { TaskAttachment } from '../types.js';
import type { AttachmentStore } from './attachment-types.js';

interface AttachmentRow {
  id: string;
  task_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

function rowToAttachment(row: AttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: Number(row.created_at),
  };
}

export class PostgresAttachmentStore implements AttachmentStore {
  constructor(private pool: Pool) {}

  async insert(a: TaskAttachment): Promise<void> {
    await this.pool.query(
      `INSERT INTO task_attachments (id, task_id, filename, original_name, mime_type, size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [a.id, a.taskId, a.filename, a.originalName, a.mimeType, a.size, a.createdAt],
    );
  }

  async getByTaskId(taskId: string): Promise<TaskAttachment[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM task_attachments WHERE task_id = $1 ORDER BY created_at ASC`,
      [taskId],
    );
    return rows.map(rowToAttachment);
  }

  async getById(id: string): Promise<TaskAttachment | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM task_attachments WHERE id = $1`,
      [id],
    );
    return rows[0] ? rowToAttachment(rows[0]) : undefined;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM task_attachments WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countByTaskId(taskId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int as cnt FROM task_attachments WHERE task_id = $1`,
      [taskId],
    );
    return rows[0].cnt;
  }
}
