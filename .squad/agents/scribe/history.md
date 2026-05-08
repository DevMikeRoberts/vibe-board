# Scribe History

## Seed Context

- Project: ai-agent-board.
- Scribe owns decisions, orchestration logs, session logs, memory hygiene, and cross-agent history updates.
- User: Copilot.

## Learnings

- Append-only files use the union merge driver in `.gitattributes`.
- Scribe must stage only files written in the current session, never broad-stage `.squad/`.
- **Exact `## Members` format is critical after roster restructuring:** The Members section header and table format must match exactly across downstream scripts and validation. Inconsistency causes silent failures in role detection. After any roster changes, validate that the section has the header `## Members` followed by a properly formatted table row for each agent.
