import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentType } from '../src/types.js';
import {
  resolveAgentSelection,
  getConfiguredFallbackAgent,
  AGENT_TIERS,
  FALLBACK_AGENT_ENV,
  type AgentAvailability,
} from '../src/services/agent-fallback.js';

const DISPLAY: Record<AgentType, string> = {
  copilot: 'GitHub Copilot',
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
};

/** Build an availability snapshot; `available` lists the agents that are up. */
function snapshot(available: AgentType[], reasons: Partial<Record<AgentType, string>> = {}): AgentAvailability[] {
  return (Object.keys(DISPLAY) as AgentType[]).map(name => ({
    name,
    displayName: DISPLAY[name],
    available: available.includes(name),
    reason: available.includes(name) ? undefined : reasons[name] ?? 'CLI not found',
  }));
}

test('returns the requested agent when it is available (no fallback)', () => {
  const result = resolveAgentSelection({
    requested: 'claude',
    agents: snapshot(['claude', 'opencode']),
  });
  assert.equal(result.agentType, 'claude');
  assert.equal(result.fellBack, false);
  assert.equal(result.reason, undefined);
});

test('falls back to a free/local model when the requested agent is down', () => {
  const result = resolveAgentSelection({
    requested: 'claude',
    agents: snapshot(['opencode', 'copilot'], { claude: 'out of credits' }),
  });
  assert.equal(result.agentType, 'opencode'); // local tier wins
  assert.equal(result.fellBack, true);
  assert.match(result.reason ?? '', /out of credits/);
  assert.match(result.reason ?? '', /OpenCode/);
  assert.match(result.reason ?? '', /free\/local/);
});

test('prefers a free/local agent over a flat-rate one, and flat-rate over metered', () => {
  // Only subscription + metered available — pick the subscription (lower tier).
  const subVsMetered = resolveAgentSelection({
    requested: 'opencode',
    agents: snapshot(['copilot', 'codex']),
  });
  assert.equal(subVsMetered.agentType, 'copilot');

  // Local available alongside others — local wins.
  const localWins = resolveAgentSelection({
    requested: 'codex',
    agents: snapshot(['opencode', 'copilot', 'claude']),
  });
  assert.equal(localWins.agentType, 'opencode');
});

test('honours an explicit preferred fallback when it is available', () => {
  const result = resolveAgentSelection({
    requested: 'claude',
    agents: snapshot(['opencode', 'copilot', 'hermes']),
    preferredFallback: 'hermes',
  });
  assert.equal(result.agentType, 'hermes');
  assert.equal(result.fellBack, true);
});

test('ignores an unavailable preferred fallback and uses tier ranking instead', () => {
  const result = resolveAgentSelection({
    requested: 'claude',
    agents: snapshot(['opencode', 'copilot']),
    preferredFallback: 'codex', // not available
  });
  assert.equal(result.agentType, 'opencode');
});

test('returns null with an actionable reason when nothing is available', () => {
  const result = resolveAgentSelection({
    requested: 'claude',
    agents: snapshot([], { claude: 'out of credits' }),
  });
  assert.equal(result.agentType, null);
  assert.equal(result.fellBack, false);
  assert.match(result.reason ?? '', /no other agent is available/);
  assert.match(result.reason ?? '', /Ollama/);
});

test('never falls back to the requested agent even if listed available', () => {
  // Defensive: requested is somehow both requested and the only "available".
  const result = resolveAgentSelection({
    requested: 'claude',
    agents: snapshot(['claude']),
  });
  // It is available, so it is simply used (not a fallback).
  assert.equal(result.agentType, 'claude');
  assert.equal(result.fellBack, false);
});

test('getConfiguredFallbackAgent parses and validates the env var', () => {
  assert.equal(getConfiguredFallbackAgent({ [FALLBACK_AGENT_ENV]: 'opencode' }), 'opencode');
  assert.equal(getConfiguredFallbackAgent({ [FALLBACK_AGENT_ENV]: '  OpenCode ' }), 'opencode');
  assert.equal(getConfiguredFallbackAgent({ [FALLBACK_AGENT_ENV]: 'not-an-agent' }), undefined);
  assert.equal(getConfiguredFallbackAgent({}), undefined);
});

test('every agent type has a declared tier', () => {
  for (const name of Object.keys(DISPLAY) as AgentType[]) {
    assert.ok(AGENT_TIERS[name], `missing tier for ${name}`);
  }
});
