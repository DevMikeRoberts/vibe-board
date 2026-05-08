# Copilot Coding Agent Member

Use this reference when adding or routing work to GitHub Copilot coding agent (`@copilot`) as a Squad member for this repository.

## Role

`@copilot` is an asynchronous coding-agent member. It works through GitHub issue assignment, creates implementation branches, and opens pull requests for review.

## Roster Entry

Add a roster row that makes the member clearly distinct from spawnable Squad agents:

| Name | Role | Charter | Status |
|------|------|---------|--------|
| @copilot | Coding Agent | Uses repository Copilot instructions | 🤖 Available |

Recommended capability fields in `team.md`:

- `capability`: short description of suitable work.
- `strengths`: implementation tasks with clear acceptance criteria.
- `limits`: ambiguous architecture, secrets, production incidents, and reviewer-only work.
- `auto_assign`: `true` or `false`.

## Routing Rules

- Route only well-scoped implementation issues with explicit acceptance criteria.
- Do not route emergency production, secrets, access-control, or unclear architecture work without human/lead triage.
- Keep non-dependent Squad work moving while `@copilot` works asynchronously.
- Reviewer rejection lockout still applies; a rejected Copilot artifact must be revised by a different owner.

## Auto-Assign Marker

If used, control default assignment with a plain marker in `team.md`:

`<!-- copilot-auto-assign: false -->`

Set it to `true` only after the lead confirms issue labels, routing, and review gates are ready.

## Triage Checklist

1. Confirm the issue is repo-local and has clear acceptance criteria.
2. Confirm required labels map to `.squad/routing.md`.
3. Check whether the task crosses client/server/runtime boundaries.
4. Assign `@copilot` only when the task is implementation-ready.
5. Require normal PR review and project gates before merge.
