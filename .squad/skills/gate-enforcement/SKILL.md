---
name: "gate-enforcement"
description: "Run risk-based ai-agent-board quality gates after code-producing work."
domain: "testing"
confidence: "medium"
source: "ai-agent-board gate enforcement and commands"
---

## Context

Use this skill after any task that writes code or changes runtime behavior. Documentation-only Squad state changes only need consistency validation unless they add scripts or app-facing behavior.

## Patterns

- Identify the affected surface in `.squad/coverage-matrix.md`.
- For code-producing work, run the deterministic required gate: `npm run gate:required`.
- The required gate runs `npm run build:client`, `npm run build:server`, and `npm run test:e2e:required`; do not replace it with ad hoc build or E2E commands.
- Install the local pre-push hook with `npm run hooks:install` so Git uses `.githooks/pre-push`.
- Prefer focused existing tests before broad suites, but required gate evidence must still include `npm run gate:required`.
- E2E portability/setup problems, including hard-coded Unix paths such as `/tmp/test-repo`, are blockers to fix in the test setup before approval; they are not acceptable reasons to defer affected E2E coverage.
- Fix-loop ceiling: 3 attempts or 5 minutes on the same failing class, then escalate to Morpheus/Switch.

## Examples

- Agent runtime change: Neo owns implementation; Switch requests focused runtime tests plus `npm run gate:required`.
- Board UI change: Trinity owns implementation; Switch requests focused e2e/component evidence plus `npm run gate:required`.

## Anti-Patterns

- Do not weaken or skip tests to make a gate pass.
- Do not treat unrelated baseline failures as proof the current change is safe.
- Do not skip affected e2e for convenience, portability, unavailable dev servers, or setup friction; start/fix the required processes or fail the gate.
- Do not replace required e2e evidence with a build-only claim for browser workflow or client-server behavior changes.
- Do not run softer ad hoc E2E commands when `npm run gate:required` is available.
