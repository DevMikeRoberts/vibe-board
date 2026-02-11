import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import type { Task } from './types.js';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'kanban.db');
const DATA_DIR = path.dirname(DB_PATH);

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      priority      TEXT NOT NULL DEFAULT 'medium',
      column_id     TEXT NOT NULL DEFAULT 'backlog',
      agent_status  TEXT NOT NULL DEFAULT 'idle',
      created_at    INTEGER NOT NULL,
      started_at    INTEGER,
      completed_at  INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      timestamp  INTEGER NOT NULL,
      metadata   TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  // Index for fast lookups by task_id + ordering by timestamp
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id, timestamp ASC)`);

  // Add worktree columns if they don't exist yet
  const cols = db.pragma('table_info(tasks)') as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('repo_path')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN repo_path TEXT`);
  }
  if (!colNames.has('branch_name')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN branch_name TEXT`);
  }
  if (!colNames.has('base_branch')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN base_branch TEXT`);
  }
  if (!colNames.has('use_worktree')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN use_worktree INTEGER`);
  }
  if (!colNames.has('worktree_path')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN worktree_path TEXT`);
  }
  if (!colNames.has('agent_type')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'copilot'`);
  }
}

const seeds: Omit<Task, 'id'>[] = [
  {
    title: 'Set up authentication middleware',
    description: 'Implement JWT-based authentication middleware for the Express API. Should validate tokens on protected routes and attach user info to the request object.',
    priority: 'high',
    columnId: 'backlog',
    agentStatus: 'idle',
    agentType: 'copilot',
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    title: 'Create user profile API endpoint',
    description: 'Build GET /api/users/:id and PATCH /api/users/:id endpoints. Include validation with zod schemas and proper error responses.',
    priority: 'medium',
    columnId: 'backlog',
    agentStatus: 'idle',
    agentType: 'copilot',
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    title: 'Implement WebSocket event streaming',
    description: 'Set up WebSocket server with ws library. Broadcast agent events to connected clients in real-time. Handle reconnection and error states.',
    priority: 'critical',
    columnId: 'in-progress',
    agentStatus: 'idle',
    agentType: 'copilot',
    createdAt: Date.now() - 86400000,
  },
  {
    title: 'Write integration tests for task CRUD',
    description: 'Create comprehensive integration tests for all task endpoints using supertest. Cover edge cases and error scenarios.',
    priority: 'medium',
    columnId: 'review',
    agentStatus: 'complete',
    agentType: 'copilot',
    createdAt: Date.now() - 86400000 * 4,
    startedAt: Date.now() - 86400000,
    completedAt: Date.now() - 3600000,
  },
  {
    title: 'Configure Docker multi-stage build',
    description: 'Create Dockerfile with multi-stage build for production. Optimize image size with Alpine base. Add docker-compose for local development.',
    priority: 'high',
    columnId: 'done',
    agentStatus: 'complete',
    agentType: 'copilot',
    createdAt: Date.now() - 86400000 * 5,
    startedAt: Date.now() - 86400000 * 2,
    completedAt: Date.now() - 86400000,
  },
];

function seed(db: Database.Database): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get() as { cnt: number };
  if (row.cnt > 0) return;

  const insert = db.prepare(`
    INSERT INTO tasks (id, title, description, priority, column_id, agent_status, agent_type, created_at, started_at, completed_at)
    VALUES (@id, @title, @description, @priority, @column_id, @agent_status, @agent_type, @created_at, @started_at, @completed_at)
  `);

  const insertMany = db.transaction((items: typeof seeds) => {
    for (const s of items) {
      insert.run({
        id: uuid(),
        title: s.title,
        description: s.description,
        priority: s.priority,
        column_id: s.columnId,
        agent_status: s.agentStatus,
        agent_type: s.agentType,
        created_at: s.createdAt,
        started_at: s.startedAt ?? null,
        completed_at: s.completedAt ?? null,
      });
    }
  });

  insertMany(seeds);
  console.log(`[db] seeded ${seeds.length} tasks`);
}

export function initDatabase(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
  console.log(`[db] initialized at ${DB_PATH}`);
  return db;
}
