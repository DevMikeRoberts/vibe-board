---
name: "otel-validation"
description: "Use telemetry evidence for Squad usage and process audits when available."
domain: "observability"
confidence: "low"
source: "ai-agent-board telemetry-aware audit practice"
---

## Context

Use when auditing Squad usage, delegation quality, model mix, tool-call behavior, or session bottlenecks.

## Patterns

- Prefer telemetry/session-store evidence when available.
- Significant work-unit routing accuracy is the primary KPI; raw tool/task counts are supporting evidence.
- Pair telemetry with `.squad/orchestration-log/` entries and git history.

## Examples

- A drift audit checks whether substantial code changes had corresponding agent delegation and orchestration logs.
- A model-policy audit checks whether routine work stayed on standard/fast models instead of premium reviewers.

## Anti-Patterns

- Do not judge delegation quality only by raw tool counts.
- Do not expose private telemetry contents in user-facing summaries.
