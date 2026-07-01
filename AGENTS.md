# AGENTS.md

## Project Overview

Agentic AI Kanban Board — a drag-and-drop Kanban board that delegates coding tasks to AI coding agents (GitHub Copilot, Claude Code, OpenAI Codex, OpenCode, Hermes, OpenClaw). Monorepo with npm workspaces.

## Architecture

```
ai-agent-board/
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
├── scripts/             # required gate, hook install, and E2E process helpers
└── k8s/                 # Kubernetes manifests (namespace, deployments, services, ingress)
```

## Key Technical Decisions

- **Multi-agent support** — pluggable `AgentProvider`/`AgentSession` interfaces from `@codewithdan/agent-sdk-core`. Six providers: `copilot` (`@github/copilot-sdk`), `claude` (`@anthropic-ai/claude-agent-sdk`), `codex` (`@openai/codex-sdk`), `opencode` (`@opencode-ai/sdk`), `hermes`, and `openclaw`. Auto-detected at startup via `detectAgents()`.
- **Agent SDK abstraction** — all provider implementations live in the external `@codewithdan/agent-sdk-core` package. The server imports providers and the detection function from this package.
- **Dual database backends** — SQLite via `better-sqlite3` (default, zero config) or PostgreSQL via `pg` (set `DATABASE_URL`). Both implement the `TaskRepository` and `TemplateRepository` interfaces.
- **Route splitting** — REST API is split across `tasks.ts` (CRUD), `agent.ts` (start/stop/events/follow-up), `git.ts` (merge-local, create-pr, worktree cleanup, git-info), `templates.ts` (task template CRUD), and `groups.ts` (group CRUD + run/stop/archive).
- **Auto-PR + merge watcher** — when a standalone task completes successfully on a repo with an `origin` remote, the board automatically opens a PR for its branch (`autoOpenPrOnComplete` in `routes/helpers.ts`) and records `prUrl`. The `PrWatcher` service (`services/pr-watcher.ts`) polls those PRs and, once one is merged, moves the task to **done** and cleans up the worktree + local branch. Gated by the `autoPrEnabled` setting (default on); group children are excluded and roll up to their group instead.
- **Repo-scan pre-step** — non-Claude agents (Copilot, Codex, OpenCode, Hermes, OpenClaw) tend to edit before understanding the repo. `services/repo-scan.ts` injects a Claude-native repo-scan skill into their system prompt that forces a repository-understanding pass (read docs/manifests, map layout, learn conventions) and a `<repo-scan>` brief before any edit. Claude is exempt; toggle with `AGENTBOARD_REPO_SCAN`. Human-readable mirror at `.claude/skills/repo-scan/SKILL.md`.
- **API key auth** — optional Bearer token via `API_KEY` env var. When set, all API and WebSocket requests require `Authorization: Bearer <key>`. Middleware in `middleware/auth.ts`.
- **Task Groups** — parent entity with N child tasks, concurrency-controlled execution via `GroupQueue` in agent-manager. Groups move as a single card on the board; auto-advance to review when all children complete. Parallelism slider locked once running.
- **Event streaming** — SDK events mapped to `AgentEvent`s, persisted to database, broadcast via WebSocket. In-memory LRU cache (200 tasks max, 100 events per task).
- **Git worktrees** — optional per-task branch isolation. Agent works in worktree directory, path rewriting via `onPreToolUse` hook. Worktrees auto-cleaned after successful merge, PR creation, or once a watched PR is merged.
- **Local merge** — `mergeLocal()` merges worktree branch into base branch locally with per-repo mutex to prevent concurrent checkout races. Auto-aborts on conflict.
- **Smart PR/merge buttons** — `GET /api/tasks/:id/git-info` checks for remote; UI shows "Create PR" only when remote exists, "Merge to main" always available.
- **Vite proxy** — client proxies `/api` and `/ws` to the server.
- **Shared validation** — `shared/constants.ts` exports validators (`isValidPriority`, `isValidColumnId`, etc.) and limits (`MAX_TITLE_LENGTH`, `MAX_DESCRIPTION_LENGTH`) used by both client and server.

## Running Locally

```bash
npm install
npm run dev:server   # Terminal 1 — port 3001
npm run dev:client   # Terminal 2 — port 4175
```

## Production (systemd)

The production server (`kanban.codewithdan.com`) runs via two systemd services:

| Service | Unit File | Port | Description |
|---------|-----------|------|-------------|
| `ai-agent-board-server` | `/etc/systemd/system/ai-agent-board-server.service` | 3001 | Express API + WebSocket + agent SDKs |
| `ai-agent-board-client` | `/etc/systemd/system/ai-agent-board-client.service` | 4175 | Vite dev server (proxied by nginx/reverse proxy) |

```bash
# Check status
systemctl status ai-agent-board-server ai-agent-board-client

# Restart after code changes
systemctl restart ai-agent-board-server ai-agent-board-client

# View logs
journalctl -u ai-agent-board-server -f
journalctl -u ai-agent-board-client -f

# Restart just one
systemctl restart ai-agent-board-server
systemctl restart ai-agent-board-client
```

**Important:** The server reads `packages/server/.env` via dotenv. Production uses PostgreSQL via the `ai-agent-board-db` Docker container (postgres:16-alpine on port 5433). DB credentials: `user=agentboard, db=agentboard`. If the password needs resetting: `docker exec ai-agent-board-db psql -U agentboard -c "ALTER USER agentboard WITH PASSWORD '<pass>'"`. Do **not** fall back to SQLite in production.

## Build

```bash
npm run gate:required  # required gate: client build, server build, E2E
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
| `DB_PATH` | `./data/agentboard.db` | SQLite database file path |
| `COPILOT_MODEL` | `claude-opus-4-20250514` | Model for Copilot SDK sessions |
| `CLAUDE_MODEL` | `claude-opus-4-20250514` | Model for Claude Code sessions |
| `CODEX_MODEL` | `gpt-5.2-codex` | Model for OpenAI Codex sessions |
| `HERMES_COMMAND` | `hermes` | Hermes CLI command or absolute path used to start the ACP server |
| `OPENCLAW_COMMAND` | `openclaw` | OpenClaw CLI command or absolute path used to start the ACP bridge |
| `OPENCLAW_GATEWAY_URL` | _(none)_ | Optional OpenClaw Gateway WebSocket URL forwarded to `openclaw acp` |
| `COPILOT_DENIED_TOOLS` | _(none)_ | Comma-separated tool names to deny in Copilot sessions |
| `ALLOWED_REPO_ROOTS` | `$HOME`, temp, current workspace | Comma-separated allowed repo root paths (security whitelist) |
| `ALLOWED_ORIGINS` | `http://localhost:4175,http://localhost:4176` | CORS origins |
| `AGENT_TIMEOUT_MS` | `600000` (10 min) | Max agent execution time |
| `AGENTBOARD_REPO_SCAN` | `1` (on) | Inject the repo-scan skill into non-Claude agents so they build repository context before implementing; set to `0`/`false` to disable |
| `API_URL` | `http://localhost:3001` | Vite proxy target |
| `PROJECTS_DIR` | `~/projects` | Host projects path |

## Tests

```bash
# Deterministic required gate (client build, server build, E2E)
npm run gate:required

# Required E2E only; Playwright starts isolated test app processes on ports 3002/4176
npm run test:e2e:required

# Enable the committed pre-push hook for this clone
npm run hooks:install
```

The committed `.githooks/pre-push` hook runs `npm run gate:required` and must not silently skip E2E. 7 test files, 81 tests (79 active, 2 skipped integration): board (CRUD, drag, theme, priority, sort, filter, retry), API improvements (auto-run, batch, status, events), agent selector, task groups (CRUD, validation, edge cases, UI), git operations (merge, PR, worktree), group integration (real agent execution), agent SDK. Portability/setup problems are blockers to fix, not reasons to skip affected e2e coverage.

## Code Patterns

- **Task lifecycle**: backlog → in-progress → review → done (validated transitions in `VALID_TRANSITIONS` from `shared/constants.ts`). With auto-PR on, a completed task lands in **review** with an open PR and is advanced to **done** automatically by `PrWatcher` when that PR merges.
- **Agent lifecycle**: idle → planning → executing → complete/failed (set via `agentStatus`)
- **Agent types**: `copilot | claude | codex | opencode | hermes | openclaw` — each task can specify which agent to use via `agentType`
- **Provider pattern**: `AgentProvider` creates `AgentSession`s (from `@codewithdan/agent-sdk-core`). `AgentManager` orchestrates sessions with timeouts, event caching, and graceful cleanup.
- **Repository pattern**: `TaskRepository`, `TemplateRepository`, and `TaskGroupRepository` interfaces with SQLite and PostgreSQL implementations.
- **Event coalescing**: AgentPanel merges consecutive thinking/output events for readability
- **Graceful shutdown**: 5s force-exit timeout after `SIGINT`/`SIGTERM`, all SDK sessions cleaned up
- **Copilot permission request**: SDK uses `req.kind` (shell/read/write/mcp/url/memory), NOT `req.toolName`
- **Group queue**: `GroupQueue` in agent-manager tracks pending/running/completed/failed per group. `drainQueue()` fills slots up to `maxConcurrency` as children complete.
- **Per-repo mutex**: `withRepoLock()` serializes git operations (merge, checkout) on the same repository to prevent concurrent modification races.
- **Startup recovery**: Orphaned tasks (`executing`/`planning` without live session) reset to `failed` on server restart. Groups reconstruct queue from DB state.

## Squad Operating Mode

- **Roster/routing**: Use `.squad/team.md` and `.squad/routing.md` for domain ownership before non-trivial work.
- **Critical behaviors**: Use `.squad/coverage-matrix.md` to classify risk for agent runtime, git/worktrees, auth/path safety, event streaming, task groups, repositories, and board workflows. Browser workflow/client-server changes must produce deterministic e2e evidence or fail the gate.
- **Skills**: Check `.copilot/skills/` for general process skills and `.squad/skills/` for project-specific patterns before starting work.
- **Completion summaries**: After significant agent batches, report `Asked:`, `Completed:`, and `Open issues:` so blockers are not hidden in logs.

## Known Issues (LOW priority)

- Search input missing `aria-label` (Header.tsx)
- No WebSocket re-sync after reconnection (api.ts)
- `db.close()` not in try/catch during shutdown (index.ts)
- Keyboard shortcuts don't check `contenteditable` elements (useKeyboardShortcuts.ts)
- Timer leak in CopyButton if component unmounts within 2s (AgentPanel.tsx)
