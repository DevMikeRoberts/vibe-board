# Copilot Kanban Agent

A drag-and-drop Kanban board that assigns coding tasks to AI agents — GitHub Copilot, Claude Code, OpenAI Codex, or OpenCode. Drop a task into "In Progress," pick an agent, and it will plan, execute, and complete the work, streaming live progress back to the board.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Tailwind CSS 4, Framer Motion |
| Drag & Drop | @dnd-kit |
| Backend | Express, better-sqlite3 / PostgreSQL, ws (WebSocket) |
| AI Agents | @codewithdan/agent-sdk-core (wraps @github/copilot-sdk, @anthropic-ai/claude-agent-sdk, @openai/codex-sdk, @opencode-ai/sdk) |
| Terminal UI | @xterm/xterm |
| Monorepo | npm workspaces |
| Dev Environment | Docker Compose with live-reload volumes |

## Features

- Kanban board with Backlog, In Progress, Review, Done columns
- **Multi-agent support** — choose GitHub Copilot, Claude Code, OpenAI Codex, or OpenCode per task
- Auto-detection of available agents at startup
- Drag-and-drop task management with transition validation
- Real-time agent activity streaming via WebSocket
- Terminal-style event viewer (xterm.js) with ANSI color support
- Agent panel with event coalescing (thinking, commands, output)
- Git worktree isolation per task (optional)
- One-click PR creation from completed tasks
- **Dual database backends** — SQLite (zero-config default) or PostgreSQL
- Task templates for reusable task configurations
- **Task Groups** — define multiple related tasks in one form, launch with configurable parallelism (slider 1..N), monitor aggregate progress
- Auto-run option to start agent immediately on task creation
- Priority levels (critical, high, medium, low) with emoji indicators and color-coded borders
- Filter and sort tasks by agent type, status, and priority
- API key authentication (optional — set `API_KEY` env var)
- Task archiving
- Dark/light theme toggle
- Task search and filtering
- Keyboard shortcuts (N: new task, G: new group, Esc: close panels)

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- At least one agent CLI authenticated on your machine:
  - **GitHub Copilot**: `gh extension install github/gh-copilot` + `gh auth login`
  - **Claude Code**: `claude` CLI installed and authenticated
  - **OpenAI Codex**: `codex` CLI installed with API key configured
  - **OpenCode**: `opencode` CLI installed and configured
- Docker & Docker Compose (for containerized dev)

### Option 1: Docker Compose (Recommended)

```bash
git clone https://github.com/DanWahlin/copilot-kanban-board.git
cd copilot-kanban-agent
cp .env.example .env        # Edit .env if you need PostgreSQL or custom settings
docker compose up -d
```

Open [http://localhost:4175](http://localhost:4175).

- **Client** runs on port 4175 with Vite HMR
- **Server** runs on port 3001 with tsx watch
- Edit source files locally — changes are picked up instantly via volume mounts

```bash
docker compose logs -f           # Watch logs
docker compose down              # Stop
docker compose build --no-cache  # Rebuild after dependency changes
```

#### Repo Paths in Docker

When configuring a task's repository path, use `/host-projects/my-app` instead of `~/projects/my-app`. Your `~/projects` directory is mounted at `/host-projects` inside the server container.

To change the host projects directory:

```bash
PROJECTS_DIR=/path/to/your/projects docker compose up -d
```

### Option 2: Run Directly

```bash
npm install

# Terminal 1 — API server (port 3001)
npm run dev:server

# Terminal 2 — Vite dev server (port 4175)
npm run dev:client
```

Open [http://localhost:4175](http://localhost:4175).

### Build for Production

```bash
npm run build:server
npm run build:client
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | _(unset)_ | Bearer token for API + WebSocket auth; unset = open access |
| `VITE_API_KEY` | _(unset)_ | Client-side API key (must match `API_KEY`) |
| `PORT` | `3001` | Server port |
| `DATABASE_URL` | _(unset)_ | PostgreSQL connection string; when unset, uses SQLite |
| `DB_PATH` | `./data/kanban.db` | SQLite database file path |
| `COPILOT_MODEL` | `claude-opus-4-20250514` | Model for Copilot SDK sessions |
| `CLAUDE_MODEL` | `claude-opus-4-20250514` | Model for Claude Code sessions |
| `CODEX_MODEL` | `gpt-5.2-codex` | Model for OpenAI Codex sessions |
| `COPILOT_DENIED_TOOLS` | _(unset)_ | Comma-separated tool names to deny in Copilot sessions |
| `ALLOWED_REPO_ROOTS` | `$HOME,/tmp` | Allowed repo root paths (comma-separated) |
| `ALLOWED_ORIGINS` | `http://localhost:4175,http://localhost:4176` | CORS origins |
| `AGENT_TIMEOUT_MS` | `600000` | Max agent execution time (ms) |
| `API_URL` | `http://localhost:3001` | Vite proxy target (auto-set in Docker) |
| `PROJECTS_DIR` | `~/projects` | Host projects path for Docker volume |

## Project Structure

```
copilot-kanban-agent/
├── docker-compose.yml         # Two-container dev setup
├── Dockerfile.client          # Vite dev server image
├── Dockerfile.server          # Express + agent SDKs image
├── packages/
│   ├── client/                # React frontend
│   │   └── src/
│   │       ├── components/    # Board, Column, TaskCard, TaskGroupCard, GroupPanel, AgentPanel, TerminalView, FilterChips, dialogs
│   │       ├── hooks/         # useTasks, useTaskGroups, useTheme, useDebounce, useKeyboardShortcuts
│   │       └── lib/           # API client, WebSocket, agent-config, priority-config, utilities
│   ├── server/                # Express backend
│   │   └── src/
│   │       ├── middleware/     # Bearer token auth
│   │       ├── routes/        # REST API split: tasks, agent, git, templates, groups
│   │       ├── services/      # Agent session orchestration via @codewithdan/agent-sdk-core
│   │       ├── repositories/  # SQLite + PostgreSQL data access (tasks + templates + groups)
│   │       ├── db.ts          # Database init + migrations
│   │       └── websocket.ts   # Real-time event broadcast
│   └── e2e/                   # Playwright end-to-end tests
└── shared/                    # Shared types (Task, TaskGroup, TaskTemplate, AgentEvent, etc.) + validation
```

## How It Works

1. **Create a task** in the Backlog column
2. **Drag it to In Progress** — the agent panel opens automatically
3. **Configure the run** — set the repo path, branch name, agent type, and whether to use a git worktree
4. **Click Start Agent** — the selected agent begins working, streaming progress in real-time
5. **Review the results** — commands executed, files modified, output produced
6. **Create a PR** directly from the agent panel when the task completes

### Multi-Agent Architecture

The server uses a **provider pattern** (via `@codewithdan/agent-sdk-core`) to support multiple AI coding agents behind a common interface:

- **`AgentProvider`** — creates sessions, reports availability
- **`AgentSession`** — runs a task, emits events, supports abort
- **`AgentManager`** — orchestrates sessions with timeouts, event caching, and graceful cleanup

Each task can specify which agent to use. Available agents are auto-detected at startup by checking for installed CLIs. Four providers are supported: Copilot, Claude Code, Codex, and OpenCode. Events from all providers are normalized into a common `AgentEvent` format and streamed to the UI via WebSocket.

### Task Groups

For projects needing multiple parallel changes, **Task Groups** let you define a batch of related tasks in a single form:

1. Click **New Group** (or press `G`) to open the group creation dialog
2. Set group-level config: title, repo path, base branch, priority
3. Add child tasks (2–20), each with its own title, description, agent type, and worktree toggle
4. Set **parallelism** with a slider (1 to N) — controls how many agents run concurrently
5. Click **Create & Run** to launch immediately, or **Create Group** to add to backlog

Groups appear as a single card on the board showing aggregate progress. Click to expand the **Group Panel** with per-child status, retry buttons for failures, and drill-through to individual agent panels. Groups auto-advance to "review" when all children complete successfully.

## Tests

```bash
# Run all E2E tests (requires client + server running)
npm test

# Run directly
cd packages/e2e && npx playwright test --reporter=list
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
