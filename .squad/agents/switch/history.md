# Switch History

## Seed Context

- Project: ai-agent-board.
- E2E tests live in `packages/e2e` and use Playwright.
- Current test scope covers board CRUD, drag/drop, theme, priority, sort/filter/retry, API improvements, agent selector, task groups, git operations, group integration, and agent SDK behavior.
- User: Copilot.

## Learnings

- E2E tests require both server and client running.
- Quality gates should be risk-based: agent runtime, git/worktrees, auth/path security, and group queue changes need focused evidence.
- 2026-05-08T06:01:23.732-07:00 — Windows Local Path validation should pair client/server builds with a direct server path-boundary check using `ALLOWED_REPO_ROOTS=D:\git`; impacted E2E task helpers still hard-code `/tmp/test-repo`, so they are not safe Windows path smokes without adjustment.
- 2026-05-08T12:19:35.686-07:00 — E2E tests that need Local Path coverage should use shared repo helpers (`prepareTestRepo`/`fillLocalPath`) so paths come from `os.tmpdir()` or `E2E_TEST_REPO_ROOT` and valid git repos are created explicitly.
