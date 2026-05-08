# Team Wisdom

Reusable patterns and heuristics learned through work. NOT transcripts.

## Patterns

**Pattern:** Treat agent runtime, git worktrees, auth/path security, event streaming, task group concurrency, and DB migrations as P0/P1 surfaces. **Context:** These behaviors can corrupt repos, leak secrets, orphan sessions, or break the core board workflow.

**Pattern:** Broad green e2e suites are not enough for route/client contract changes. **Context:** API client changes should have route-level or fetch-capture tests that prove the client and Express routes still agree.

**Pattern:** Worktree and merge operations need both runtime and security review. **Context:** Path rewriting, repo-root allowlists, branch checkout, and merge mutex behavior are safety boundaries.

**Pattern:** Production must not silently fall back to SQLite. **Context:** `AGENTS.md` says production uses PostgreSQL through `packages/server/.env`; fallback is local-dev behavior only.

**Pattern:** Completion summaries must surface open issues explicitly. **Context:** ai-agent-board coordination depends on making blockers visible with `Asked:`, `Completed:`, and `Open issues:`.
