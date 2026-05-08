# Squad Decisions

## Active Decisions

### E2E gates are non-discretionary

**Decision:** Required browser/client-server E2E tests must be deterministic and must not be skipped because they are inconvenient, slow, or not portable on the current OS.

**Rationale:** Regression prevention depends on reliable evidence. If an affected E2E cannot run, the correct outcome is to fix the setup or test portability issue, not to report the test as "not run" while treating the work as complete.

**Implementation:** `npm run gate:required` is the required local/CI/pre-push gate. It builds the client and server, starts deterministic E2E web servers, runs Playwright required tests, and fails on test failure or setup failure.

**Allowed exception:** Explicit external integration tests may skip only when they require unavailable third-party credentials or tools, and only when the required deterministic coverage for the changed behavior still runs.

### Windows agent detection is SDK-first with explicit local fallback

**Decision:** Keep `@codewithdan/agent-sdk-core` as the primary provider detector, then normalize only the Copilot result on Windows when the SDK reports unavailable.

**Rationale:** Windows installs can expose `copilot.exe` through WinGet Links, npm shims, or PowerShell command resolution in ways a raw `execFile('copilot')` SDK probe can miss. The board should reflect the actual local runtime without replacing the provider abstraction or trusting shell-mediated execution.

**Implementation:** On Windows, discover Copilot candidates with `where.exe copilot`, PowerShell `Get-Command copilot`, and direct PATH executable lookup. Verify discovered candidates by explicit path using `--version`, then `version`, then `--help`; mark Copilot available only when one explicit health probe succeeds, preserving detailed SDK/fallback failure reasons otherwise.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
