# Neo History

## Seed Context

- Project: ai-agent-board.
- Agent runtime is centered on `packages/server/src/services/agent-manager.ts`.
- Supported providers: copilot, claude, codex, opencode.
- Agent events are persisted, cached, and broadcast over WebSocket.
- Git worktrees provide optional per-task branch isolation.
- User: Copilot.

## Learnings

- Copilot permission request handling uses `req.kind`, not `req.toolName`.
- Worktree path rewriting and per-repo merge locks are core safety mechanisms.
