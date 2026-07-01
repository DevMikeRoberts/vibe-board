import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentType } from '../src/types.js';
import {
  REPO_SCAN_ENV,
  isClaudeAgent,
  isRepoScanEnabled,
  shouldRunRepoScan,
  buildRepoScanPromptSection,
} from '../src/services/repo-scan.js';

const NON_CLAUDE: AgentType[] = ['copilot', 'codex', 'opencode', 'hermes', 'openclaw'];

test('isClaudeAgent only matches claude', () => {
  assert.equal(isClaudeAgent('claude'), true);
  for (const a of NON_CLAUDE) assert.equal(isClaudeAgent(a), false);
});

test('repo scan is enabled by default when the env var is unset', () => {
  assert.equal(isRepoScanEnabled({}), true);
});

test('repo scan can be disabled with falsey env values', () => {
  for (const v of ['0', 'false', 'no', 'off', 'FALSE', ' Off ']) {
    assert.equal(isRepoScanEnabled({ [REPO_SCAN_ENV]: v }), false, `expected disabled for "${v}"`);
  }
});

test('non-falsey env values keep repo scan enabled', () => {
  for (const v of ['1', 'true', 'yes', 'on', 'anything']) {
    assert.equal(isRepoScanEnabled({ [REPO_SCAN_ENV]: v }), true, `expected enabled for "${v}"`);
  }
});

test('shouldRunRepoScan is true for non-Claude agents and false for Claude', () => {
  for (const a of NON_CLAUDE) assert.equal(shouldRunRepoScan(a, {}), true);
  assert.equal(shouldRunRepoScan('claude', {}), false);
});

test('shouldRunRepoScan is false for everyone when disabled', () => {
  const env = { [REPO_SCAN_ENV]: 'false' };
  for (const a of [...NON_CLAUDE, 'claude' as AgentType]) {
    assert.equal(shouldRunRepoScan(a, env), false);
  }
});

test('buildRepoScanPromptSection injects the skill for non-Claude agents', () => {
  const section = buildRepoScanPromptSection('copilot', '/work/dir', {});
  assert.match(section, /<repo-scan-skill>/);
  assert.match(section, /<repo-scan>/);
  assert.ok(section.includes('/work/dir'), 'working directory should be interpolated');
});

test('buildRepoScanPromptSection returns empty for Claude', () => {
  assert.equal(buildRepoScanPromptSection('claude', '/work/dir', {}), '');
});

test('buildRepoScanPromptSection returns empty when disabled', () => {
  assert.equal(buildRepoScanPromptSection('copilot', '/work/dir', { [REPO_SCAN_ENV]: '0' }), '');
});
