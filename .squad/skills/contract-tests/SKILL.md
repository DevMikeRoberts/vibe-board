---
name: "contract-tests"
description: "Keep client API calls, Express routes, and shared types aligned."
domain: "testing"
confidence: "medium"
source: "ai-agent-board frontend/backend contract practice"
---

## Context

Use when changing `packages/client/src/lib/api.ts`, Express routes, shared types/constants, repository return shapes, or WebSocket payloads.

## Patterns

- For REST changes, prove the client path/method/body matches the server route.
- For shared types, update all consumers in client/server/runtime together.
- For WebSocket events, check the persisted event shape, broadcast shape, and rendered shape.
- Prefer local-runnable focused tests over tests that require production services.

## Examples

- A task route path change should include both route-level server coverage and client API expectation coverage.
- An AgentEvent shape change should include server event mapping and AgentPanel rendering evidence.

## Anti-Patterns

- Do not rely on mocked client tests that never exercise the real route path.
- Do not duplicate types locally in the client or server.
