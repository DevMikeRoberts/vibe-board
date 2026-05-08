---
name: "completion-summary-contract"
description: "Require clear user-facing summaries after completed agent batches."
domain: "communication"
confidence: "medium"
source: "ai-agent-board coordinator summary contract"
---

## Context

Use after any completed agent/task batch or significant direct coordinator action.

## Patterns

The final user-facing summary includes these labels, in this order:

1. `Asked:` concise restatement of the request.
2. `Completed:` compact, specific outcomes.
3. `Open issues:` blockers, failing checks, unresolved follow-ups, pending reviews, or `None`.

## Examples

Asked: Upgrade the Squad.
Completed: Added roster, routing, charters, skills, and validation gates.
Open issues: No app build was needed because changes were Squad metadata only.

## Anti-Patterns

- Do not hide blockers only in Scribe logs.
- Do not claim completion if validation found inconsistencies.
