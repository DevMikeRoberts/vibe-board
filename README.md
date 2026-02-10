# Copilot Kanban Agent

A drag-and-drop Kanban board that assigns coding tasks to GitHub Copilot as an autonomous agent. Drop a task into "In Progress" and Copilot will plan, execute, and complete the work — streaming live progress back to the board.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, Tailwind CSS 4, Framer Motion |
| Drag & Drop | @dnd-kit |
| Backend | Express, better-sqlite3, ws (WebSocket) |
| AI Agent | @github/copilot-sdk |
| Monorepo | npm workspaces |
| Dev Environment | Docker Compose with live-reload volumes |

## Features

- Kanban board with Backlog, In Progress, Review, Done columns
- Drag-and-drop task management with transition validation
- Real-time agent activity streaming via WebSocket
- Agent panel with event coalescing (thinking, commands, output)
- Git worktree isolation per task (optional)
- One-click PR creation from completed tasks
- Delete confirmation dialogs
- Dark/light theme toggle
- Task search and filtering
- Keyboard shortcuts (N: new task, Esc: close panels)
- Accessible dialogs with ARIA attributes

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- GitHub Copilot CLI (`gh extension install github/gh-copilot`)
- Authenticated via `gh auth login`
- Docker & Docker Compose (for containerized dev)

### Option 1: Docker Compose (Recommended)

```bash
git clone <repo-url>
cd copilot-kanban-agent
docker compose up -d
```

That's it. Open [http://localhost:4175](http://localhost:4175).

- **Client** runs on port 4175 with Vite HMR
- **Server** runs on port 3001 with tsx watch
- Edit source files locally — changes are picked up instantly via volume mounts

```bash
docker compose logs -f        # Watch logs
docker compose down           # Stop
docker compose build --no-cache  # Rebuild after dependency changes
```

#### Repo Paths in Docker

When configuring a task's repository path, use `/host-projects/my-app` instead of `~/projects/my-app`. Your `~/projects` directory is mounted at `/host-projects` inside the server container. The Copilot agent can read and write files on your host through this mount.

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
| `PORT` | `3001` | Server port |
| `COPILOT_MODEL` | `claude-sonnet-4-20250514` | Model for Copilot sessions |
| `ALLOWED_REPO_ROOTS` | `$HOME,/tmp` | Allowed repo root paths (comma-separated) |
| `ALLOWED_ORIGINS` | `http://localhost:4175,http://localhost:4176` | CORS origins |
| `AGENT_TIMEOUT_MS` | `600000` | Max agent execution time (ms) |
| `API_URL` | `http://localhost:3001` | Vite proxy target (auto-set in Docker) |
| `PROJECTS_DIR` | `~/projects` | Host projects path for Docker volume |

## Project Structure

```
copilot-kanban-agent/
├── docker-compose.yml       # Two-container dev setup
├── Dockerfile.client        # Vite dev server image
├── Dockerfile.server        # Express + Copilot SDK image
├── packages/
│   ├── client/              # React frontend
│   │   └── src/
│   │       ├── components/  # Board, Column, TaskCard, AgentPanel, dialogs
│   │       ├── hooks/       # useTasks, useTheme, useKeyboardShortcuts
│   │       └── lib/         # API client, WebSocket, utilities
│   ├── server/              # Express backend
│   │   └── src/
│   │       ├── routes/      # REST API (task CRUD + agent lifecycle)
│   │       ├── services/    # Copilot SDK integration
│   │       ├── repositories/# SQLite data access
│   │       ├── db.ts        # Database init + migrations
│   │       └── websocket.ts # Real-time event broadcast
│   └── e2e/                 # Playwright end-to-end tests
└── shared/                  # Shared types (Task, AgentEvent, etc.)
```

## How It Works

1. **Create a task** in the Backlog column
2. **Drag it to In Progress** — the agent panel opens automatically
3. **Configure the run** — set the repo path, branch name, and whether to use a git worktree
4. **Click Start Agent** — Copilot begins working, streaming progress in real-time
5. **Review the results** — commands executed, files modified, output produced
6. **Create a PR** directly from the agent panel when the task completes

### Copilot SDK Integration

The server manages a singleton `CopilotClient` that communicates with the Copilot CLI. Each task gets its own `CopilotSession` with:

- A system message scoped to the task's working directory
- Auto-approved tool permissions (shell, read, write)
- Real-time event streaming mapped to the UI's event types
- Optional path rewriting for git worktree isolation

## Tests

```bash
# Run all E2E tests (requires client + server running)
npm test

# Run directly
cd packages/e2e && npx playwright test --reporter=list
```

## License

MIT
