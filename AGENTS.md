# AGENTS.md

## Project Overview

Copilot Kanban Agent — a drag-and-drop Kanban board that delegates coding tasks to GitHub Copilot as an autonomous agent via `@github/copilot-sdk`. Monorepo with npm workspaces.

## Architecture

```
copilot-kanban-agent/
├── packages/
│   ├── client/          # React 19 + Vite + Tailwind 4 + Framer Motion
│   │   └── src/
│   │       ├── components/  # Board, Column, TaskCard, AgentPanel, Header, dialogs
│   │       ├── hooks/       # useTasks, useTheme, useKeyboardShortcuts
│   │       └── lib/         # api.ts (REST + WebSocket), utils
│   ├── server/          # Express + better-sqlite3 + ws + Copilot SDK
│   │   └── src/
│   │       ├── routes/      # tasks.ts (CRUD + agent lifecycle)
│   │       ├── services/    # copilot.ts (SDK integration, session management)
│   │       ├── repositories/# sqlite.ts (data access layer)
│   │       ├── db.ts        # SQLite init + migrations
│   │       ├── websocket.ts # WebSocket broadcast
│   │       └── index.ts     # Express app setup + graceful shutdown
│   └── e2e/             # Playwright tests
└── shared/              # Shared types (Task, AgentEvent, ColumnId, etc.)
```

## Key Technical Decisions

- **SQLite via better-sqlite3** — synchronous API, zero config, data in `packages/server/data/kanban.db`
- **Copilot SDK** — singleton `CopilotClient`, lazy-initialized. Sessions created per task with `sendAndWait()`. All tool executions auto-approved via `onPermissionRequest`.
- **Event streaming** — SDK `SessionEvent`s mapped to `AgentEvent`s, persisted to SQLite, broadcast via WebSocket. In-memory cache with LRU eviction (200 tasks max, 100 events per task).
- **Git worktrees** — optional per-task branch isolation. Agent works in worktree directory, path rewriting via `onPreToolUse` hook.
- **Vite proxy** — client proxies `/api` and `/ws` to the server. In Docker, `API_URL` env var points to `http://server:3001`.

## Docker Setup

Two-container dev environment via Docker Compose with live-reload volumes:

```bash
docker compose up -d          # Start both containers
docker compose logs -f        # Watch logs
docker compose down           # Stop
docker compose build --no-cache  # Rebuild after dependency changes
```

### Containers

| Service | Port | Description |
|---------|------|-------------|
| `client` | 4175 | Vite dev server with HMR |
| `server` | 3001 | Express API + WebSocket + Copilot SDK |

### Volumes (live reload)

- `packages/client/src` → edit React components, Vite hot-reloads
- `packages/server/src` → edit server code, tsx watch restarts
- `shared/` → type changes picked up by both
- `packages/server/data` → SQLite persistence across restarts
- `~/projects` → mounted at `/host-projects` for Copilot agent file access

### Important: Repo Paths in Docker

When running in Docker, the Copilot agent accesses host files via the `/host-projects` mount. In the "Configure Agent Run" dialog, use `/host-projects/my-app` instead of `~/projects/my-app`.

The `ALLOWED_REPO_ROOTS` env is set to `/host-projects,/tmp` in docker-compose.yml.

## Running Without Docker

```bash
npm install
npm run dev:server   # Terminal 1 — port 3001
npm run dev:client   # Terminal 2 — port 4175
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `COPILOT_MODEL` | `claude-sonnet-4-20250514` | Model for Copilot sessions |
| `ALLOWED_REPO_ROOTS` | `$HOME,/tmp` | Comma-separated allowed repo root paths |
| `ALLOWED_ORIGINS` | `http://localhost:4175,http://localhost:4176` | CORS origins |
| `AGENT_TIMEOUT_MS` | `600000` (10 min) | Max agent execution time |
| `API_URL` | `http://localhost:3001` | Vite proxy target (set in Docker) |
| `PROJECTS_DIR` | `~/projects` | Host projects path for Docker volume |

## Tests

```bash
# E2E tests (requires both client and server running)
npm test

# Or directly
cd packages/e2e && npx playwright test
```

12 tests: 10 board tests (CRUD, drag, edit, theme, priority, agent panel), 2 agent SDK tests (full flow + worktree).

## Code Patterns

- **Task lifecycle**: backlog → in-progress → review → done (validated transitions in `VALID_TRANSITIONS`)
- **Agent lifecycle**: idle → executing → complete/failed (set via `agentStatus`)
- **Event coalescing**: AgentPanel merges consecutive thinking/output events for readability
- **Graceful shutdown**: 5s force-exit timeout after `SIGINT`/`SIGTERM`, all SDK sessions cleaned up
- **Permission request**: SDK uses `req.kind` (shell/read/write/mcp/url/memory), NOT `req.toolName`

## Known Issues (LOW priority)

- Search input missing `aria-label` (Header.tsx)
- No WebSocket re-sync after reconnection (api.ts)
- `db.close()` not in try/catch during shutdown (index.ts)
- Keyboard shortcuts don't check `contenteditable` elements (useKeyboardShortcuts.ts)
- Timer leak in CopyButton if component unmounts within 2s (AgentPanel.tsx)
