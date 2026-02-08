import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createWSS } from './websocket.js';
import { initDatabase } from './db.js';
import { SqliteTaskRepository } from './repositories/sqlite.js';
import { createTaskRouter } from './routes/tasks.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:4175,http://localhost:4176,http://100.113.87.7:4175,http://100.113.87.7:4176').split(',');
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '100kb' }));

// Initialize database and repository
const db = initDatabase();
const taskRepo = new SqliteTaskRepository(db);
app.use('/api/tasks', createTaskRouter(taskRepo));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const server = createServer(app);
createWSS(server);

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket at ws://localhost:${PORT}/ws`);
});
