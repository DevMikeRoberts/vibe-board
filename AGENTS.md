# AGENTS.md

## Project Overview

Agentic AI Kanban Board — a drag-and-drop Kanban board that delegates coding tasks to AI coding agents (GitHub Copilot, Claude Code, OpenAI Codex, OpenCode). Monorepo with npm workspaces.

## Architecture

```
agentic-ai-kanban-board/
├── packages/
│   ├── client/          # React 19 + Vite + Tailwind 4 + Framer Motion + xterm.js
│   │   └── src/
│   │       ├── components/  # Board, Column, TaskCard, TaskGroupCard, GroupPanel, AgentPanel, TerminalView, FilterChips, Header, dialogs
│   │       ├── hooks/       # useTasks, useTaskGroups, useTheme, useDebounce, useKeyboardShortcuts
│   │       ├── lib/         # api.ts (REST + WebSocket), agent-config.ts, priority-config.ts, columns.ts, utils
│   │       └── types/       # Client-side type re-exports
│   ├── server/          # Express + @codewithdan/agent-sdk-core + better-sqlite3/pg + ws
│   │   └── src/
│   │       ├── middleware/  # auth.ts (Bearer token auth)
│   │       ├── routes/      # tasks.ts, agent.ts, git.ts, templates.ts, groups.ts, helpers.ts
│   │       ├── services/    # agent-manager.ts (session orchestration, event caching)
│   │       ├── repositories/# sqlite.ts, postgres.ts, sqlite-templates.ts, postgres-templates.ts, sqlite-groups.ts, postgres-groups.ts, types.ts, template-types.ts, group-types.ts
│   │       ├── db.ts        # SQLite + PostgreSQL init + migrations
│   │       ├── websocket.ts # WebSocket broadcast
│   │       └── index.ts     # Express app setup + graceful shutdown
│   └── e2e/             # Playwright tests
├── shared/              # Shared types (Task, TaskGroup, TaskTemplate, AgentEvent, ColumnId, AgentType, etc.) + validation constants
├── scripts/             # test-sdk-e2e.sh
└── k8s/                 # Kubernetes manifests (namespace, deployments, services, ingress)
```

## Key Technical Decisions

- **Multi-agent support** — pluggable `AgentProvider`/`AgentSession` interfaces from `@codewithdan/agent-sdk-core`. Four providers: `copilot` (`@github/copilot-sdk`), `claude` (`@anthropic-ai/claude-agent-sdk`), `codex` (`@openai/codex-sdk`), `opencode` (`@opencode-ai/sdk`). Auto-detected at startup via `detectAgents()`.
- **Agent SDK abstraction** — all provider implementations live in the external `@codewithdan/agent-sdk-core` package. The server imports providers and the detection function from this package.
- **Dual database backends** — SQLite via `better-sqlite3` (default, zero config) or PostgreSQL via `pg` (set `DATABASE_URL`). Both implement the `TaskRepository` and `TemplateRepository` interfaces.
- **Route splitting** — REST API is split across `tasks.ts` (CRUD), `agent.ts` (start/stop/events/follow-up), `git.ts` (merge-local, create-pr, worktree cleanup, git-info), `templates.ts` (task template CRUD), and `groups.ts` (group CRUD + run/stop/archive).
- **API key auth** — optional Bearer token via `API_KEY` env var. When set, all API and WebSocket requests require `Authorization: Bearer <key>`. Middleware in `middleware/auth.ts`.
- **Task Groups** — parent entity with N child tasks, concurrency-controlled execution via `GroupQueue` in agent-manager. Groups move as a single card on the board; auto-advance to review when all children complete. Parallelism slider locked once running.
- **Event streaming** — SDK events mapped to `AgentEvent`s, persisted to database, broadcast via WebSocket. In-memory LRU cache (200 tasks max, 100 events per task).
- **Git worktrees** — optional per-task branch isolation. Agent works in worktree directory, path rewriting via `onPreToolUse` hook. Worktrees auto-cleaned after successful merge or PR creation.
- **Local merge** — `mergeLocal()` merges worktree branch into base branch locally with per-repo mutex to prevent concurrent checkout races. Auto-aborts on conflict.
- **Smart PR/merge buttons** — `GET /api/tasks/:id/git-info` checks for remote; UI shows "Create PR" only when remote exists, "Merge to main" always available.
- **Vite proxy** — client proxies `/api` and `/ws` to the server. In Docker, `API_URL` env var points to `http://server:3001`.
- **Shared validation** — `shared/constants.ts` exports validators (`isValidPriority`, `isValidColumnId`, etc.) and limits (`MAX_TITLE_LENGTH`, `MAX_DESCRIPTION_LENGTH`) used by both client and server.

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
| `server` | 3001 | Express API + WebSocket + agent SDKs |

### Volumes (live reload)

- `packages/client/src` → edit React components, Vite hot-reloads
- `packages/server/src` → edit server code, tsx watch restarts
- `shared/` → type changes picked up by both
- `packages/server/data` → SQLite persistence across restarts
- `~/projects` → mounted at `/host-projects` for agent file access
- Agent CLI binaries (`claude`, `codex`) and auth credentials mounted read-only from host

### Important: Repo Paths in Docker

When running in Docker, agents access host files via the `/host-projects` mount. In the "Configure Agent Run" dialog, use `/host-projects/my-app` instead of `~/projects/my-app`.

The `ALLOWED_REPO_ROOTS` env is set to `/host-projects,/tmp` in docker-compose.yml.

## Running Without Docker

```bash
npm install
npm run dev:server   # Terminal 1 — port 3001
npm run dev:client   # Terminal 2 — port 4175
```

## Build

```bash
npm run build:client   # tsc + vite build
npm run build:server   # tsc -b tsconfig.build.json
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | _(none)_ | Bearer token for API + WebSocket auth; unset = open access |
| `VITE_API_KEY` | _(none)_ | Client-side API key (must match `API_KEY`) |
| `PORT` | `3001` | Server port |
| `DATABASE_URL` | _(none)_ | PostgreSQL connection string; when unset, uses SQLite |
| `DB_PATH` | `./data/kanban.db` | SQLite database file path |
| `COPILOT_MODEL` | `claude-opus-4-20250514` | Model for Copilot SDK sessions |
| `CLAUDE_MODEL` | `claude-opus-4-20250514` | Model for Claude Code sessions |
| `CODEX_MODEL` | `gpt-5.2-codex` | Model for OpenAI Codex sessions |
| `COPILOT_DENIED_TOOLS` | _(none)_ | Comma-separated tool names to deny in Copilot sessions |
| `ALLOWED_REPO_ROOTS` | `$HOME,/tmp` | Comma-separated allowed repo root paths (security whitelist) |
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

7 test files, 81 tests (79 active, 2 skipped integration): board (CRUD, drag, theme, priority, sort, filter, retry), API improvements (auto-run, batch, status, events), agent selector, task groups (CRUD, validation, edge cases, UI), git operations (merge, PR, worktree), group integration (real agent execution), agent SDK.

## Code Patterns

- **Task lifecycle**: backlog → in-progress → review → done (validated transitions in `VALID_TRANSITIONS` from `shared/constants.ts`)
- **Agent lifecycle**: idle → planning → executing → complete/failed (set via `agentStatus`)
- **Agent types**: `copilot | claude | codex | opencode` — each task can specify which agent to use via `agentType`
- **Provider pattern**: `AgentProvider` creates `AgentSession`s (from `@codewithdan/agent-sdk-core`). `AgentManager` orchestrates sessions with timeouts, event caching, and graceful cleanup.
- **Repository pattern**: `TaskRepository`, `TemplateRepository`, and `TaskGroupRepository` interfaces with SQLite and PostgreSQL implementations.
- **Event coalescing**: AgentPanel merges consecutive thinking/output events for readability
- **Graceful shutdown**: 5s force-exit timeout after `SIGINT`/`SIGTERM`, all SDK sessions cleaned up
- **Copilot permission request**: SDK uses `req.kind` (shell/read/write/mcp/url/memory), NOT `req.toolName`
- **Group queue**: `GroupQueue` in agent-manager tracks pending/running/completed/failed per group. `drainQueue()` fills slots up to `maxConcurrency` as children complete.
- **Per-repo mutex**: `withRepoLock()` serializes git operations (merge, checkout) on the same repository to prevent concurrent modification races.
- **Startup recovery**: Orphaned tasks (`executing`/`planning` without live session) reset to `failed` on server restart. Groups reconstruct queue from DB state.

## Known Issues (LOW priority)

- Search input missing `aria-label` (Header.tsx)
- No WebSocket re-sync after reconnection (api.ts)
- `db.close()` not in try/catch during shutdown (index.ts)
- Keyboard shortcuts don't check `contenteditable` elements (useKeyboardShortcuts.ts)
- Timer leak in CopyButton if component unmounts within 2s (AgentPanel.tsx)
