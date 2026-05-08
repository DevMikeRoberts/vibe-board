# Trinity History

## Seed Context

- Project: ai-agent-board.
- Frontend lives in `packages/client/src`.
- Important components include Board, Column, TaskCard, TaskGroupCard, GroupPanel, AgentPanel, TerminalView, FilterChips, Header, and dialogs.
- User: Copilot.

## Learnings

- Client API behavior is centralized in `packages/client/src/lib/api.ts`.
- UI changes often need WebSocket/event-state awareness because agent output streams live into the board.
- 2026-05-08T06:01:23.732-07:00: Repo path UX must reflect the user's browser OS; Windows users need drive-letter and UNC examples, while POSIX examples remain useful elsewhere.
