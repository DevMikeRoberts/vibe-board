---
updated_at: 2026-05-07T12:01:42.360-07:00
phase: "squad-upgrade"
agent: "oracle"
current_task: "upgrade-squad-operating-system"
last_action: "Oracle approved the upgraded Squad roster, routing, casting, skills, ceremonies, and instruction deltas."
last_commit: "pending"
elapsed_in_task: "complete"
status: "idle"
---

# Squad Heartbeat

This file is the public pulse of the running Squad. Update it on meaningful state transitions so observers can see progress without polling the agent runtime.

## Update protocol

Rewrite the frontmatter, do not append duplicate frontmatter.

| Event | Update |
|---|---|
| Task picked up | Set `current_task`, `agent`, and `status: implementing` |
| Implementation milestone | Update `last_action` |
| Gate run started | Set `status: gating` |
| Gate passed | Set `status: committing` |
| Commit pushed | Update `last_commit`, set `status: idle` |
| Blocked | Set `status: blocked` and put the reason in `last_action` |
