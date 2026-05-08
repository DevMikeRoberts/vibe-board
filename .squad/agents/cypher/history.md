# Cypher History

## Seed Context

- Project: ai-agent-board.
- Optional API key auth uses `API_KEY` server-side and `VITE_API_KEY` client-side.
- Repo access is constrained by `ALLOWED_REPO_ROOTS`.
- Agent work can involve shell commands, worktrees, and path rewriting.
- User: Copilot.

## Learnings

- Security reviews should focus on auth bypass, WebSocket auth, path traversal, worktree escape, and secrets in agent logs/events.
- Denied unsafe operations should surface explicit errors rather than silent fallbacks.
