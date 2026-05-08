---
name: "process-hygiene"
description: "Clean up orphaned browser/test/dev-server processes safely after test bursts."
domain: "operations"
confidence: "medium"
source: "ai-agent-board process hygiene"
---

## Context

Use after Playwright, browser automation, dev-server, or long-running test sessions. Windows process cleanup must target exact PIDs, never broad process names.

## Patterns

- Prefer dry-run inspection first.
- Preserve IDE, shell, MCP, database, and intentionally running dev-server processes.
- Stop only confirmed orphaned children from the test burst.
- Record what was cleaned in the session log if Scribe runs.

## Examples

- Safe: identify a specific orphaned Playwright browser PID and stop that PID.
- Safe: leave user-launched dev servers running when they are still needed for e2e.

## Anti-Patterns

- Do not use name-based killing such as broad `Stop-Process -Name` or `taskkill /IM`.
- Do not stop processes owned by another active workflow.
