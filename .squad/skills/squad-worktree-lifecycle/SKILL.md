---
name: "squad-worktree-lifecycle"
description: "Handle ai-agent-board git worktree and merge flows safely."
domain: "git"
confidence: "medium"
source: "ai-agent-board worktree lifecycle and architecture"
---

## Context

Use for changes to worktree creation, path rewriting, merge-local, PR creation, cleanup, or agent session repo paths.

## Patterns

- Neo owns runtime/worktree mechanics; Cypher reviews path safety; Switch verifies behavior.
- Preserve the per-repo mutex for operations that checkout/merge branches.
- Auto-abort merge conflicts and surface explicit errors.
- Clean up worktrees only after successful merge or PR flow.

## Examples

- A merge-local change needs conflict behavior evidence and branch-safety review.
- A path rewrite hook change needs proof tools cannot escape the intended worktree.

## Anti-Patterns

- Do not change branches inside an active worktree unexpectedly.
- Do not normalize paths with string replacement alone when filesystem resolution is required.
