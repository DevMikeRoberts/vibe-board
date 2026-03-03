import { Pool } from 'pg';
import type { TaskTemplate, Priority, AgentType } from '../types.js';
import type { TemplateRepository } from './template-types.js';
import { isValidPriority, isValidAgentType } from '@agentic-kanban/shared/constants.js';

interface TemplateRow {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: string;
  agent_type: string;
  repo_path: string | null;
  base_branch: string | null;
  use_worktree: boolean | null;
  created_at: string;
}

function rowToTemplate(row: TemplateRow): TaskTemplate {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    priority: (isValidPriority(row.priority) ? row.priority : 'medium') as Priority,
    agentType: (isValidAgentType(row.agent_type) ? row.agent_type : 'copilot') as AgentType,
    repoPath: row.repo_path ?? undefined,
    baseBranch: row.base_branch ?? undefined,
    useWorktree: row.use_worktree ?? undefined,
    createdAt: Number(row.created_at),
  };
}

export class PostgresTemplateRepository implements TemplateRepository {
  constructor(private pool: Pool) {}

  async getAll(): Promise<TaskTemplate[]> {
    const { rows } = await this.pool.query('SELECT * FROM templates ORDER BY created_at DESC');
    return rows.map(rowToTemplate);
  }

  async getById(id: string): Promise<TaskTemplate | undefined> {
    const { rows } = await this.pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    return rows[0] ? rowToTemplate(rows[0]) : undefined;
  }

  async create(template: TaskTemplate): Promise<TaskTemplate> {
    await this.pool.query(
      `INSERT INTO templates (id, name, title, description, priority, agent_type, repo_path, base_branch, use_worktree, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [template.id, template.name, template.title, template.description, template.priority,
       template.agentType, template.repoPath ?? null, template.baseBranch ?? null,
       template.useWorktree ?? null, template.createdAt],
    );
    return template;
  }

  async update(id: string, updates: Partial<Omit<TaskTemplate, 'id' | 'createdAt'>>): Promise<TaskTemplate | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }
    if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }
    if (updates.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(updates.priority); }
    if (updates.agentType !== undefined) { fields.push(`agent_type = $${idx++}`); values.push(updates.agentType); }
    if (updates.repoPath !== undefined) { fields.push(`repo_path = $${idx++}`); values.push(updates.repoPath ?? null); }
    if (updates.baseBranch !== undefined) { fields.push(`base_branch = $${idx++}`); values.push(updates.baseBranch ?? null); }
    if (updates.useWorktree !== undefined) { fields.push(`use_worktree = $${idx++}`); values.push(updates.useWorktree ?? null); }

    if (fields.length === 0) return this.getById(id);

    values.push(id);
    await this.pool.query(`UPDATE templates SET ${fields.join(', ')} WHERE id = $${idx}`, values);
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM templates WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
