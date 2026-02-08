# Copilot Kanban Agent — Project Spec

## Overview
A web application with a beautiful Kanban board UI where tasks can be defined and delegated to GitHub Copilot CLI agents via the Copilot SDK. Users watch agents plan, execute, and complete coding tasks in real-time.

## Tech Stack
- **Frontend:** React 19 + TypeScript + Vite
- **Styling:** Tailwind CSS 4 + shadcn/ui components
- **Drag & Drop:** @dnd-kit/core (accessible, performant)
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Backend:** Node.js + Express + TypeScript
- **Real-time:** WebSocket (ws library) for streaming agent events to UI
- **Copilot SDK:** @github/copilot-sdk (TypeScript)
- **Monorepo:** Single repo, `packages/client` and `packages/server`

## UI Design Requirements
- **Clean, modern, professional** — think Linear/Notion quality
- **Dark mode by default** with light mode toggle
- **Generous whitespace**, subtle shadows, rounded corners
- **Smooth animations** on card drag, column transitions, agent progress
- **Typography:** Inter font, clear hierarchy
- **Color palette:** Neutral grays + a single accent color (blue-500)

## Kanban Board
### Columns
1. **Backlog** — tasks waiting to be started
2. **In Progress** — tasks assigned to a Copilot agent  
3. **Review** — agent finished, awaiting human review
4. **Done** — completed tasks

### Task Card
- Title (editable)
- Description (markdown support)
- Priority badge (Low/Medium/High/Critical)
- Agent status indicator (idle/planning/executing/complete/failed)
- Elapsed time when running
- Expand to see agent activity log

### Agent Activity Panel
When a card is "In Progress", clicking it opens a side panel showing:
- Real-time streaming of agent events (thinking, tool calls, file edits, commands)
- Syntax-highlighted code diffs
- Terminal-style command output
- Progress indicator

## Backend API
```
POST   /api/tasks           — Create a task
GET    /api/tasks           — List all tasks
PATCH  /api/tasks/:id       — Update task (title, description, status, column)
DELETE /api/tasks/:id       — Delete a task
POST   /api/tasks/:id/run   — Delegate task to Copilot agent
POST   /api/tasks/:id/stop  — Stop a running agent
WS     /ws                  — WebSocket for real-time agent events
```

## Copilot SDK Integration
```typescript
import { CopilotClient } from '@github/copilot-sdk';

// Create client (manages CLI lifecycle)
const client = new CopilotClient();

// Create a session for a task
const session = await client.createSession({
  instruction: task.description,
  workingDirectory: '/path/to/workspace',
});

// Stream events to WebSocket clients
session.on('event', (event) => {
  wss.clients.forEach(ws => ws.send(JSON.stringify({
    taskId: task.id,
    event
  })));
});

// Start the agent
await session.sendMessage(task.description);
```

## File Structure
```
copilot-kanban-agent/
├── packages/
│   ├── client/              # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Board.tsx
│   │   │   │   ├── Column.tsx
│   │   │   │   ├── TaskCard.tsx
│   │   │   │   ├── TaskDialog.tsx
│   │   │   │   ├── AgentPanel.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   └── ThemeToggle.tsx
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── types/
│   │   │   └── App.tsx
│   │   ├── index.html
│   │   ├── tailwind.config.ts
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── server/              # Express backend
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   ├── services/
│       │   │   └── copilot.ts
│       │   ├── types/
│       │   └── websocket.ts
│       ├── tsconfig.json
│       └── package.json
├── SPEC.md
├── README.md
└── package.json             # Workspace root
```

## Phase 1 (Now): Beautiful UI Shell
Build the complete frontend with mock data. No backend yet.
- Kanban board with drag-and-drop
- Task creation dialog
- Agent activity panel with simulated streaming
- Dark/light mode
- Responsive layout
- All animations and transitions polished

## Phase 2: Backend + SDK Integration
- Express server with REST API
- WebSocket streaming
- Copilot SDK session management
- Real agent execution

## Phase 3: Azure Deployment
- Dockerize
- Azure Container Apps via azd
- CI/CD with GitHub Actions
