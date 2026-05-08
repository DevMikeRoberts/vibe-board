---
name: "heartbeat-staleness-gate"
description: "Detect stale Squad heartbeat and require visible progress updates."
domain: "process"
confidence: "medium"
source: "ai-agent-board heartbeat practice"
---

## Context

Use when Ralph checks status, after major work batches, or before claiming long-running work is complete.

## Patterns

- Read `.squad/heartbeat.md` frontmatter.
- `updated_at`, `agent`, `current_task`, `last_action`, and `status` should reflect the latest meaningful state.
- Rewrite frontmatter instead of appending duplicate frontmatter blocks.
- If heartbeat is stale, route a small update to Scribe/Ralph before continuing with status claims.

## Examples

- After a gate passes, set `status: committing`.
- After work finishes, set `status: idle` and record `last_action`.

## Anti-Patterns

- Do not leave stale "implementing" status after work has completed.
- Do not bury current status only in agent output.
