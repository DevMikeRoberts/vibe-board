import Database from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

// ─── SQLite ──────────────────────────────────────────────────────────────────

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
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    )
  `);

  // Migrate existing events table to ON DELETE CASCADE if needed
  const fkList = db.pragma('foreign_key_list(events)') as Array<{ on_delete: string }>;
  const hasCascade = fkList.some((fk) => fk.on_delete === 'CASCADE');
  if (!hasCascade) {
    db.exec(`
      BEGIN;
      CREATE TABLE events_new (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL,
        type       TEXT NOT NULL,
        content    TEXT NOT NULL,
        timestamp  INTEGER NOT NULL,
        metadata   TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      INSERT INTO events_new SELECT * FROM events;
      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;
      COMMIT;
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id, timestamp ASC)`);
  }

  // Index for fast lookups by task_id + ordering by timestamp
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id, timestamp ASC)`);

  // Add indexes for tasks table
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_column_id ON tasks(column_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_column_created ON tasks(column_id, created_at)`);

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
  if (!colNames.has('archived')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  }
}

export function initDatabase(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000'); // wait up to 10s on lock contention
  migrate(db);
  console.log(`[db] initialized at ${DB_PATH}`);
  return db;
}

// ─── PostgreSQL ──────────────────────────────────────────────────────────────

export async function initPostgresDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      priority      TEXT NOT NULL DEFAULT 'medium',
      column_id     TEXT NOT NULL DEFAULT 'backlog',
      agent_status  TEXT NOT NULL DEFAULT 'idle',
      created_at    BIGINT NOT NULL,
      started_at    BIGINT,
      completed_at  BIGINT,
      repo_path     TEXT,
      branch_name   TEXT,
      base_branch   TEXT,
      use_worktree  BOOLEAN,
      worktree_path TEXT,
      agent_type    TEXT NOT NULL DEFAULT 'copilot',
      archived      BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  // Incremental column migrations — same pattern as SQLite migrate()
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks'
  `);
  const colNames = new Set(rows.map((r: { column_name: string }) => r.column_name));
  const addCol = async (name: string, def: string) => {
    if (!colNames.has(name)) {
      await pool.query(`ALTER TABLE tasks ADD COLUMN ${name} ${def}`);
    }
  };
  await addCol('repo_path', 'TEXT');
  await addCol('branch_name', 'TEXT');
  await addCol('base_branch', 'TEXT');
  await addCol('use_worktree', 'BOOLEAN');
  await addCol('worktree_path', 'TEXT');
  await addCol('agent_type', "TEXT NOT NULL DEFAULT 'copilot'");
  await addCol('archived', 'BOOLEAN NOT NULL DEFAULT FALSE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      timestamp  BIGINT NOT NULL,
      metadata   TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id, timestamp ASC)
  `);

  // Migrate existing FK to ON DELETE CASCADE if not already set
  const { rows: fkRows } = await pool.query(`
    SELECT rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'events' AND tc.constraint_type = 'FOREIGN KEY'
  `);
  const hasCascade = fkRows.some((r: { delete_rule: string }) => r.delete_rule === 'CASCADE');
  if (!hasCascade) {
    await pool.query(`
      ALTER TABLE events
        DROP CONSTRAINT IF EXISTS events_task_id_fkey,
        ADD CONSTRAINT events_task_id_fkey
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    `);
  }
}

// ─── Backend selection helper ────────────────────────────────────────────────

export function isPostgresUrl(url: string | undefined): boolean {
  return !!url && (url.startsWith('postgresql://') || url.startsWith('postgres://'));
}
