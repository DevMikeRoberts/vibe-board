import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createWSS } from './websocket.js';
import { initDatabase } from './db.js';
import { SqliteTaskRepository } from './repositories/sqlite.js';
import { createTaskRouter } from './routes/tasks.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(cors());
app.use(express.json());

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
