# Morpheus History

## Seed Context

- Project: ai-agent-board, an agentic AI Kanban board that delegates tasks to coding agents.
- Stack: React 19 + Vite + Tailwind 4 client; Express + TypeScript server; SQLite/PostgreSQL; WebSocket event streaming; Playwright e2e.
- Key architecture: provider abstraction through `@codewithdan/agent-sdk-core`, split REST routes, repository interfaces, task groups, git worktrees, local merge, PR creation.
- User: Copilot.

## Learnings

- `shared/constants.ts` is the source for task lifecycle validation and shared limits.
- Cross-domain changes should coordinate client, server, shared types, and agent runtime owners.
- 2026-05-08T12:19:35.686-07:00: Browser workflow/client-server changes need deterministic e2e evidence; e2e portability or setup friction is a gate blocker, not a deferrable follow-up.
