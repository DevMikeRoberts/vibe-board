<p align="center">
  <img src="images/logo.png" alt="AI Agent Board logo" width="300">
</p>

<p align="center">
  <a href="#how-it-works">How It Works</a> •
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#environment-variables">Environment Variables</a> •
  <a href="#tests">Tests</a> •
  <a href="#contributing">Contributing</a>
</p>

[![CI](https://github.com/DanWahlin/ai-agent-board/actions/workflows/ci.yml/badge.svg)](https://github.com/DanWahlin/ai-agent-board/actions/workflows/ci.yml)

# AI Agent Board

A drag-and-drop Kanban board that delegates coding tasks to AI agents — GitHub Copilot, Claude Code, OpenAI Codex, OpenCode, Hermes, or OpenClaw. Drop a task into "In Progress," pick an agent, and it will plan, execute, and complete the work, streaming live progress back to the board.

![AI Agent Board in action](images/agent-board-in-action.gif)

<!-- TODO: Replace the GIF above or add a second screenshot of the current UI (HomePage, Projects, Sprint Planner) -->
<!-- ![New UI screenshot](images/screenshot.png) -->

## How It Works

1. **Create a project** — link a git repo or clone one from GitHub
2. **Create a task** in the Backlog column (or use the Sprint Planner to batch-create from a description)
3. **Drag it to In Progress** — the agent panel opens automatically
4. **Configure the run** — set the repo path, branch name, and agent type
5. **Click Start Agent** — the selected agent begins working, streaming progress in real-time
6. **Review the results** — commands executed, files modified, output produced
7. **Merge or create a PR** — merge the branch to main locally, or create a PR if the repo has a GitHub remote

### Multi-Agent Architecture

The server uses a **provider pattern** (via [`@codewithdan/agent-sdk-core`](https://github.com/DanWahlin/agent-sdk-core)) to support multiple AI coding agents behind a common interface:

- **`AgentProvider`** — creates sessions, reports availability
- **`AgentSession`** — runs a task, emits events, supports abort
- **`AgentManager`** — orchestrates sessions with timeouts, event caching, and graceful cleanup

Each task can specify which agent to use. Available agents are auto-detected at startup by checking for installed CLIs. Six providers are supported: Copilot, Claude Code, Codex, OpenCode, Hermes, and OpenClaw. Events from all providers are normalized into a common `AgentEvent` format and streamed to the UI via WebSocket.

### Agent availability fallback

When a task picks up its agent, a resolver
([`services/agent-fallback.ts`](packages/server/src/services/agent-fallback.ts))
checks whether the requested agent is actually available. If it isn't —
uninstalled, unauthenticated, or **out of credits** — the task no longer fails
outright. Instead it falls back to another available agent, **preferring a
free/local model** so the work still gets done. Agents are ranked by tier:

| Tier | Agents | Why it's preferred on fallback |
|------|--------|--------------------------------|
| `local` | OpenCode | Runs a local model (e.g. **Ollama** on your Mac Mini) — free and never out of credits |
| `subscription` | Copilot, Hermes, OpenClaw | Flat-rate plans, usually usable even when metered budgets are exhausted |
| `metered` | Claude, Codex | Pay-per-token APIs that can run out of credits |

The swap is recorded in the task's event log and the agent badge updates live.
To make a **local Ollama model** the fallback, install and authenticate the
OpenCode CLI and point it at your Ollama endpoint; OpenCode then shows up as
available and is chosen first whenever a paid agent is down. Set
`AGENTBOARD_FALLBACK_AGENT` to pin a specific fallback agent instead of relying
on tier ranking.

### Auto-PR + merge watcher

When **Auto-open PR on completion** is enabled (Settings ⚙️, on by default), a
task that finishes successfully on a repo with a GitHub `origin` remote doesn't
just stop in the **Review** column waiting for a manual click — the board
automatically pushes its branch, opens a pull request, and records the PR URL on
the task ([`autoOpenPrOnComplete`](packages/server/src/routes/helpers.ts)).

From there the [`PrWatcher`](packages/server/src/services/pr-watcher.ts) service
polls each open PR and, the moment it is merged, moves the task to **Done** and
cleans up after it — removing the worktree and deleting the local branch. Polling
(rather than a GitHub webhook) keeps the flow self-contained and restart-safe:
the watch state lives on the task row, so a restarted server simply resumes
watching on its next tick. Repos without a remote are untouched and keep the
manual **Create PR** / **Merge to main** buttons. Group children are excluded —
they continue to roll up to their group.

### Token-limit retry

Metered agents (Claude, Codex) and subscription plans can hit a token / usage /
rate limit mid-task. When **Retry on token limit** is enabled (Settings ⚙️), a
task that fails for that reason is **not** left failed — the scheduler
([`services/task-scheduler.ts`](packages/server/src/services/task-scheduler.ts))
parses the limit's reset time from the error
([`services/token-limit.ts`](packages/server/src/services/token-limit.ts)) and
automatically re-runs the task shortly after it resets.

The reset time is detected (best-effort, provider-agnostic) from common forms:
an explicit epoch, an ISO timestamp, a relative delay (`retry-after: 30`),
or a wall-clock time. When no time can be parsed, a configurable **fallback
delay** (default 60 min) is used. The task card shows a "Retry HH:MM" badge
while a retry is pending, and the scheduled retry survives a server restart.
Manually running, moving, or deleting the task cancels the pending retry.

### Auto-pickup (staggering the backlog)

Enable **Auto-pickup backlog** (Settings ⚙️) to have the board work through the
backlog on its own: it automatically starts the next idle backlog task — **one
at a time per project** — as soon as the project has nothing running (and no
pending token-limit retry). Tasks are picked highest-priority first, then
oldest first. Turning the setting on immediately evaluates the backlog; a
periodic safety tick also keeps it moving if any completion signal is missed.

### Task Groups

For projects needing multiple parallel changes, **Task Groups** let you define a batch of related tasks in a single form:

1. Click **New Group** (or press `G`) to open the group creation dialog
2. Set group-level config: title, repo path, base branch, priority
3. Add child tasks (2–20), each with its own title, description, and agent type
4. Set **parallelism** with a slider (1 to N) — controls how many agents run concurrently
5. Click **Create & Run** to launch immediately, or **Create Group** to add to backlog

Groups appear as a single card on the board showing aggregate progress. Click to expand the **Group Panel** with per-child status, retry buttons for failures, and drill-through to individual agent panels. Groups auto-advance to "review" when all children complete successfully.

### Sprint Planner

The **Sprint Planner** lets you describe a sprint in natural language and have an AI agent break it into individual task tickets on the board. Open it from the board header, provide a sprint name and description, pick an agent and project, and the planner will create a batch of well-structured tasks ordered by dependency — ready to run.

### Companion AI

The **Board Companion** is a built-in chat assistant that lives on the home page. Ask it to plan tasks, open projects, check on PRs, or help with general coding questions. It streams responses in real-time using the same agent infrastructure as task execution.

### Projects

**Projects** let you organize tasks by repository. Create a project by linking a local path or cloning a GitHub repo. The board tracks per-project task counts, supports project-level settings (base branch, default agent, auto-pickup), and auto-loads your personal GitHub repos when a token is configured.

## Features

- Kanban board with Backlog, In Progress, Review, Done columns
- **Home dashboard** with project stats, dithered tree visualization, and companion chat
- **Multi-project management** — link local repos or clone from GitHub, per-project settings
- **Multi-agent support** — choose GitHub Copilot, Claude Code, OpenAI Codex, OpenCode, Hermes, or OpenClaw per task
- Auto-detection of available agents at startup
- Drag-and-drop task management with transition validation
- Real-time agent activity streaming via WebSocket
- Terminal-style event viewer (xterm.js) with ANSI color support
- Agent panel with event coalescing (thinking, commands, output)
- Git worktree isolation on every task (always on — each run gets its own branch + worktree)
- **Local merge or PR** — merge worktree branch to main locally, or create a PR if a GitHub remote exists
- **Auto-PR + merge watcher** — completed tasks auto-open a PR and move to Done automatically once that PR is merged
- Worktree auto-cleanup after merge, PR creation, watched-PR merge, or archival
- **Dual database backends** — SQLite (zero-config default) or PostgreSQL
- Task templates for reusable task configurations
- **Task Groups** — define multiple related tasks in one form, launch with configurable parallelism
- **Sprint Planner** — describe a sprint in natural language, AI breaks it into tickets
- **Board Companion** — built-in chat assistant for planning, PR help, and coding questions
- **Image attachments** — upload screenshots/diagrams to tasks (PNG, JPEG, GIF, WebP; up to 10 MB)
- **Token-limit retry** — auto re-run a task around the time its agent's limit resets
- **Auto-pickup (staggering)** — automatically start the next backlog task, one at a time per project
- Auto-run option to start agent immediately on task creation
- Priority levels (critical, high, medium, low) with emoji indicators and color-coded borders
- Filter and sort tasks by agent type, status, and priority
- API key authentication (optional — set `API_KEY` env var)
- Task archiving
- Dark/light theme toggle
- Task search and filtering
- Keyboard shortcuts (N: new task, G: new group, Esc: close panels)
- Connection status indicator with automatic reconnection

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+
- At least one agent CLI authenticated on your machine:
  - **GitHub Copilot**: CLI installed and authenticated
  - **Claude Code**: CLI installed and authenticated
  - **OpenAI Codex**: CLI installed and authenticated
  - **OpenCode**: CLI installed and authenticated
  - **Hermes**: Hermes Agent installed and `hermes acp --check` succeeds
  - **OpenClaw**: OpenClaw CLI installed and Gateway/session access configured

Works on **Linux**, **macOS**, and **Windows**.

### Quick Start

```bash
git clone https://github.com/DanWahlin/ai-agent-board.git
cd ai-agent-board
npm install

# Start both server and client together
npm run dev

# Or run them separately:
# Terminal 1 — API server (port 8080)
npm run dev:server
# Terminal 2 — Vite dev server (port 8081)
npm run dev:client
```

Open [http://localhost:8081](http://localhost:8081).

### Database Options

By default the app uses **SQLite** — zero configuration required.

For **PostgreSQL**, start the database container and set `DATABASE_URL`:

```bash
docker compose up -d

# Set the connection string in packages/server/.env
DATABASE_URL=postgresql://agentboard:your_password@localhost:5433/agentboard
```

### Build for Production

```bash
npm run build:server
npm run build:client
```

### Deploying online (Vercel frontend + self-hosted backend)

The backend is a long-running, stateful server (WebSockets, agent subprocesses,
git worktrees, local filesystem), so it **cannot run on Vercel's serverless
platform**. The recommended topology is:

- **Frontend → Vercel** (static Vite build)
- **Backend → a Docker container on an always-on host** you control (e.g. a Mac Mini)

**1. Self-host the backend (Docker):**

```bash
# On the always-on host, from the repo root:
export ALLOWED_ORIGINS="https://your-board.vercel.app"   # your Vercel URL
export API_KEY="$(openssl rand -hex 24)"                 # protect the public endpoint
export ANTHROPIC_API_KEY="sk-ant-..."                    # for the Claude agent
export GH_TOKEN="ghp_..."                                # for pushing branches / opening PRs
export AGENTBOARD_DATA="$(pwd)/agentboard-data"          # persistent DB + repos (MUST be an absolute host path)

docker compose up -d --build server
```

The backend listens on `:8080`. Expose it over HTTPS (a reverse proxy or a
tunnel such as `cloudflared`) and point your Vercel frontend at that URL.

**2. Deploy the frontend (Vercel):**

Import the repo into Vercel. Build settings come from [`vercel.json`](vercel.json)
(`framework: vite`, builds the `shared` + `client` workspaces, SPA rewrite). Set
these **Environment Variables** in the Vercel project, then deploy:

| Variable | Value |
|----------|-------|
| `VITE_API_BASE` | `https://your-backend-host` (no trailing `/api`) |
| `VITE_API_KEY` | the same value as the backend `API_KEY` |

### Required Gate

Use the deterministic gate before pushing changes. It runs the client build, server build, and required Playwright E2E suite; if E2E cannot run, the command fails.

```bash
npm run gate:required

# Enable the committed pre-push hook for this clone
npm run hooks:install
```

## Project Structure

```
ai-agent-board/
├── packages/
│   ├── client/                # React 19 + Vite + Tailwind 4 + Framer Motion
│   │   └── src/
│   │       ├── components/    # Board, Column, TaskCard, TaskGroupCard, GroupPanel,
│   │       │                  # AgentPanel, TerminalView, HomePage, ProjectsPage,
│   │       │                  # ProjectsSidebar, BoardCompanion, SprintPlannerDialog,
│   │       │                  # ImageUpload, TaskFullView, FilterChips, Header, dialogs
│   │       ├── hooks/         # useTasks, useTaskGroups, useProjects, useCompanion,
│   │       │                  # useTheme, useConnectionStatus, useDebounce, useKeyboardShortcuts
│   │       └── lib/           # api.ts (REST + WebSocket), agent-config.ts, columns.ts,
│   │                          # priority-config.ts, group-utils.tsx, utils.ts
│   ├── server/                # Express + agent-sdk-core + better-sqlite3/pg + ws
│   │   └── src/
│   │       ├── middleware/     # auth.ts (Bearer token auth)
│   │       ├── routes/        # tasks, agent, git, templates, groups, projects,
│   │       │                  # attachments, system, companion, sprint
│   │       ├── services/      # agent-manager, task-scheduler, pr-watcher,
│   │       │                  # agent-fallback, token-limit, repo-loader
│   │       ├── repositories/  # SQLite + PostgreSQL (tasks, templates, groups,
│   │       │                  # projects, attachments)
│   │       ├── db.ts          # Database init + migrations
│   │       └── websocket.ts   # Real-time event broadcast
│   └── e2e/                   # Playwright end-to-end tests
├── shared/                    # Shared types + validation constants
└── scripts/                   # Required gate, hook install, E2E process helpers
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | _(unset)_ | Bearer token for API + WebSocket auth; unset = open access |
| `VITE_API_KEY` | _(unset)_ | Client-side API key (must match `API_KEY`) |
| `VITE_API_BASE` | _(unset)_ | Absolute backend origin for hosted frontends (e.g. `https://board-api.example.com`); unset = same-origin/Vite proxy |
| `PORT` | `8080` | Server port |
| `DATABASE_URL` | _(unset)_ | PostgreSQL connection string; when unset, uses SQLite |
| `DB_PATH` | `./data/agentboard.db` | SQLite database file path |
| `COPILOT_MODEL` | `claude-opus-4-20250514` | Model for Copilot SDK sessions |
| `CLAUDE_MODEL` | `claude-opus-4-20250514` | Model for Claude Code sessions |
| `CODEX_MODEL` | `gpt-5.2-codex` | Model for OpenAI Codex sessions |
| `HERMES_COMMAND` | `hermes` | Hermes CLI command or absolute path |
| `HERMES_MODEL` | `configured default` | Display/configured model label for Hermes sessions |
| `HERMES_ACCEPT_HOOKS` | _(unset)_ | Set to `true` to auto-approve Hermes startup hook prompts |
| `OPENCLAW_COMMAND` | `openclaw` | OpenClaw CLI command or absolute path |
| `OPENCLAW_GATEWAY_URL` | _(SDK default)_ | Optional OpenClaw Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_PASSWORD` | _(unset)_ | Optional OpenClaw Gateway credentials |
| `COPILOT_DENIED_TOOLS` | _(unset)_ | Comma-separated tool names to deny in Copilot sessions |
| `AGENTBOARD_FALLBACK_AGENT` | _(unset)_ | Pin the fallback agent when the requested one is unavailable |
| `ALLOWED_REPO_ROOTS` | `$HOME`, temp, current workspace | Allowed repo root paths (comma-separated) |
| `ALLOWED_ORIGINS` | `http://localhost:8081,http://localhost:4175,http://localhost:4176` | CORS origins |
| `AGENT_TIMEOUT_MS` | _(unset)_ | Max agent execution time (ms); `0` or unset = no timeout |
| `AGENTBOARD_REPO_SCAN` | `1` (on) | Inject repo-scan skill into non-Claude agents; `0` to disable |
| `API_URL` | `http://localhost:8080` | Vite proxy target |
| `PROJECTS_DIR` | `~/projects` | Host projects path |
| `AGENTBOARD_CONTAINER_MODE` | _(unset)_ | Set to `1` to run each task in an ephemeral Docker container |
| `ANTHROPIC_API_KEY` | _(unset)_ | Anthropic key for per-task containers |
| `GH_TOKEN` | _(unset)_ | GitHub token for pushing branches and opening PRs |
| `AGENT_RUNNER_IMAGE` | `agentboard-agent-runner:latest` | Image for per-task agent containers |
| `AGENTBOARD_DATA_HOST` | _(unset)_ | Absolute host path for Docker bind mounts |
| `AGENTBOARD_DATA_DIR` | `/data` | In-container mount point of the shared data dir |

## Tests

```bash
# Required deterministic gate: client build, server build, E2E
npm run gate:required

# Required E2E only; starts isolated test app processes on ports 3002/4176
npm run test:e2e:required

# Run directly from the E2E workspace
cd packages/e2e && npx playwright test --reporter=list
```

The local pre-push hook in `.githooks/pre-push` runs `npm run gate:required`. Run `npm run hooks:install` once per clone to enable it with `core.hooksPath .githooks`.

7 test files covering 81 tests:

| File | Tests | Coverage |
|------|-------|----------|
| `board.spec.ts` | 14 | Task CRUD, drag & drop, theme, priority, sorting, filters, retry |
| `api-improvements.spec.ts` | 20 | Auto-run, batch create, status endpoint, WebSocket events, follow-up messages |
| `agent-selector.spec.ts` | 7 | Agent selection UI, badges, worktree dialog |
| `groups.spec.ts` | 28 | Group CRUD, validation, archive, edge cases, UI |
| `git-operations.spec.ts` | 8 | Local merge, conflict handling, PR creation, worktree cleanup |
| `group-integration.spec.ts` | 2 | Full agent execution with real agents, stop & cleanup |
| `agent-sdk.spec.ts` | 2 | Real Copilot SDK execution (skipped without test repo) |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Framer Motion |
| Drag & Drop | @dnd-kit |
| Backend | Express, better-sqlite3 / PostgreSQL, ws (WebSocket) |
| AI Agents | [@codewithdan/agent-sdk-core](https://github.com/DanWahlin/agent-sdk-core) (Copilot, Claude Code, Codex, OpenCode, Hermes, OpenClaw) |
| Terminal UI | @xterm/xterm |
| Monorepo | npm workspaces |
| Dev Environment | Direct install (Linux, macOS, Windows) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
