import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createWSS } from './websocket.js';
import { initDatabase, initPostgresDatabase, isPostgresUrl } from './db.js';
import { SqliteTaskRepository } from './repositories/sqlite.js';
import { PostgresTaskRepository } from './repositories/postgres.js';
import { createTaskRouter } from './routes/tasks.js';
import { AgentManager } from './services/agent-manager.js';
import type { TaskRepository } from './repositories/types.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:4175,http://localhost:4176').split(',');
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '100kb' }));

const DATABASE_URL = process.env.DATABASE_URL;

let taskRepo: TaskRepository;
let cleanupDb: () => void;

// Initialize AgentManager
const agentManager = new AgentManager();

(async () => {
  if (isPostgresUrl(DATABASE_URL)) {
    // PostgreSQL backend
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: DATABASE_URL });
    await initPostgresDatabase(pool);
    taskRepo = new PostgresTaskRepository(pool);
    cleanupDb = () => { pool.end(); };
    console.log('[server] using PostgreSQL backend');
  } else {
    // SQLite fallback
    const db = initDatabase();
    taskRepo = new SqliteTaskRepository(db);
    cleanupDb = () => { db.close(); };
    console.log('[server] using SQLite backend');
  }

  agentManager.initEventPersistence(taskRepo);

  app.use('/api/tasks', createTaskRouter(taskRepo, agentManager));

  // GET /api/agents — list available agents
  app.get('/api/agents', (_req, res) => {
    res.json(agentManager.getAvailableAgents());
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  const server = createServer(app);
  createWSS(server);

  await agentManager.initialize();

  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] WebSocket at ws://localhost:${PORT}/ws`);
  });

  // Graceful shutdown
  function shutdown() {
    console.log('[server] shutting down...');
    agentManager.shutdownAll();
    cleanupDb();
    server.close(() => process.exit(0));
    setTimeout(() => {
      console.warn('[server] force exit after timeout');
      process.exit(1);
    }, 5_000).unref();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})();
