# Tank History

## Seed Context

- Project: ai-agent-board.
- Backend lives in `packages/server/src`.
- Routes are split across tasks, agent, git, templates, groups, and helpers.
- Repositories support SQLite by default and PostgreSQL when `DATABASE_URL` is set.
- User: Copilot.

## Learnings

- Production must not silently fall back to SQLite; `packages/server/.env` drives production PostgreSQL.
- Repository interfaces should stay aligned across SQLite and PostgreSQL implementations.
- 2026-05-08T06:01:23.732-07:00: Local Windows experimentation needs explicit `ALLOWED_REPO_ROOTS` entries such as `D:\git`; preserve the allowlist and compare Windows paths case-insensitively.
