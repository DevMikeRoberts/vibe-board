import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectTokenLimit, isTokenLimitError, parseResetTime } from '../src/services/token-limit.js';

// Fixed reference "now": 2026-06-30T12:00:00Z
const NOW = Date.parse('2026-06-30T12:00:00Z');

test('non-limit errors are not classified as limits', () => {
  assert.equal(isTokenLimitError('spawn claude ENOENT'), false);
  assert.equal(isTokenLimitError('Worktree setup failed: fatal: not a git repository'), false);
  assert.equal(isTokenLimitError(''), false);
  assert.equal(isTokenLimitError(undefined), false);
  assert.equal(detectTokenLimit('agent container exited with code 1').isLimit, false);
});

test('recognizes common limit phrasings', () => {
  assert.equal(isTokenLimitError('Error 429: Too Many Requests'), true);
  assert.equal(isTokenLimitError('rate_limit_error: please slow down'), true);
  assert.equal(isTokenLimitError('Claude AI usage limit reached'), true);
  assert.equal(isTokenLimitError('You exceeded your current quota'), true);
  assert.equal(isTokenLimitError('token limit exceeded'), true);
});

test('parses the Claude Code pipe-delimited epoch (seconds)', () => {
  const reset = Math.floor(Date.parse('2026-06-30T17:00:00Z') / 1000);
  const info = detectTokenLimit(`Claude AI usage limit reached|${reset}`, NOW);
  assert.equal(info.isLimit, true);
  assert.equal(info.resetAt, reset * 1000);
});

test('parses an epoch in milliseconds near a reset keyword', () => {
  const resetMs = Date.parse('2026-06-30T15:30:00Z');
  const info = detectTokenLimit(`rate limit hit; resets at ${resetMs}`, NOW);
  assert.equal(info.resetAt, resetMs);
});

test('parses an ISO reset timestamp', () => {
  const info = detectTokenLimit(
    'usage limit reached; service resets at 2026-06-30T18:00:00Z',
    NOW,
  );
  assert.equal(info.resetAt, Date.parse('2026-06-30T18:00:00Z'));
});

test('parses retry-after seconds', () => {
  const info = detectTokenLimit('rate limit exceeded, retry-after: 30', NOW);
  assert.equal(info.resetAt, NOW + 30_000);
});

test('parses "try again in N seconds" (OpenAI style)', () => {
  const info = detectTokenLimit('Rate limit reached. Please try again in 20s.', NOW);
  assert.equal(info.resetAt, NOW + 20_000);
});

test('parses "try again in N minutes"', () => {
  const info = detectTokenLimit('Too many requests. Please try again in 5 minutes.', NOW);
  assert.equal(info.resetAt, NOW + 5 * 60_000);
});

test('parses a wall-clock reset time to the next future occurrence', () => {
  // 3pm local relative to NOW; compute expected via the same local-clock logic.
  const expected = (() => {
    const d = new Date(NOW);
    d.setHours(15, 0, 0, 0);
    let t = d.getTime();
    if (t <= NOW) t += 24 * 3_600_000;
    return t;
  })();
  const info = detectTokenLimit('5-hour limit reached ∙ resets at 3pm', NOW);
  assert.equal(info.resetAt, expected);
});

test('limit without a parseable time has no resetAt', () => {
  const info = detectTokenLimit('You have hit your usage limit. Upgrade your plan.', NOW);
  assert.equal(info.isLimit, true);
  assert.equal(info.resetAt, undefined);
});

test('ignores implausible / out-of-window epochs', () => {
  // A small unrelated number near "reset" should not be taken as an epoch.
  assert.equal(parseResetTime('rate limit; reset code 12345', NOW), undefined);
  // An epoch far in the past is out of the accepted window.
  assert.equal(parseResetTime('usage limit reached|1000000000', NOW), undefined);
});
