/**
 * Token / usage / rate-limit detection for agent failures.
 *
 * When an agent (Claude or any other) stops because it ran out of tokens or hit
 * a usage/rate limit, the failure text usually carries a hint about when the
 * limit resets. This module classifies such failures and best-effort parses the
 * reset time so the scheduler can re-run the task around then instead of failing
 * it outright.
 *
 * It is intentionally provider-agnostic and pure (no I/O), so it is easy to unit
 * test and reuse for any agent's error/event output.
 */

export interface TokenLimitInfo {
  /** True when the text looks like a token/usage/rate-limit failure. */
  isLimit: boolean;
  /**
   * Epoch ms at which the limit is expected to reset, when one could be parsed
   * from the text. Undefined when the text is a limit but carries no usable
   * time — the caller should fall back to a configured default delay.
   */
  resetAt?: number;
}

/** Phrases that indicate a token/usage/rate-limit (as opposed to a generic error). */
const LIMIT_PATTERNS: readonly RegExp[] = [
  /rate[\s_-]?limit/i,
  /usage limit/i,
  /token limit/i,
  /too many requests/i,
  /\b429\b/,
  /\bquota\b/i,
  /limit reached/i,
  /limit exceeded/i,
  /insufficient_quota/i,
];

// Plausible epoch window so a stray number isn't mistaken for a timestamp:
// 2001-09-09 (1e9 s) … 2096 (4e12 ms).
const MIN_EPOCH_S = 1_000_000_000;
const MAX_EPOCH_S = 4_000_000_000;

/** True when `text` reads like a token/usage/rate-limit failure. */
export function isTokenLimitError(text: string | undefined | null): boolean {
  if (!text) return false;
  return LIMIT_PATTERNS.some((re) => re.test(text));
}

/** Normalize a numeric epoch (seconds or milliseconds) to ms, or undefined. */
function epochToMs(raw: number): number | undefined {
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  // Heuristic: >= 1e12 is already milliseconds, otherwise seconds.
  const seconds = raw >= 1e12 ? raw / 1000 : raw;
  if (seconds < MIN_EPOCH_S || seconds > MAX_EPOCH_S) return undefined;
  return Math.round(seconds * 1000);
}

/** Unit string → milliseconds multiplier. */
function unitToMs(unit: string): number | undefined {
  const u = unit.toLowerCase();
  if (/^(s|sec|secs|second|seconds)$/.test(u)) return 1_000;
  if (/^(m|min|mins|minute|minutes)$/.test(u)) return 60_000;
  if (/^(h|hr|hrs|hour|hours)$/.test(u)) return 3_600_000;
  return undefined;
}

/**
 * Compute the next future occurrence of a wall-clock time (server-local) from
 * `now`. Used for messages like "resets at 3pm" / "reset at 11:30 PM".
 */
function nextClockTime(now: number, hour: number, minute: number, ampm?: string): number | undefined {
  let h = hour;
  if (ampm) {
    const isPm = /pm/i.test(ampm);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
  }
  if (h < 0 || h > 23 || minute < 0 || minute > 59) return undefined;
  const d = new Date(now);
  d.setHours(h, minute, 0, 0);
  let t = d.getTime();
  if (t <= now) t += 24 * 3_600_000; // already passed today → tomorrow
  return t;
}

/**
 * Best-effort parse of when a limit resets from arbitrary error/event text.
 * Tries, in order: an explicit epoch timestamp, an ISO timestamp, a relative
 * "try again in N <unit>" / "retry-after" delay, then a wall-clock reset time.
 * Returns epoch ms, or undefined when nothing usable is found.
 */
export function parseResetTime(text: string, now: number = Date.now()): number | undefined {
  if (!text) return undefined;
  const inWindow = (t: number) => t > now - 5 * 60_000 && t < now + 30 * 24 * 3_600_000;

  // 1) Explicit epoch — either the Claude Code "…limit reached|<epoch>" form or
  //    a number near a reset/retry keyword. Avoids matching unrelated digits.
  const epochContexts = [
    /\|\s*(\d{10,13})/,
    /(?:reset|resets|reset_at|reset at|retry|available again|try again|until)[^0-9]{0,40}?(\d{10,13})/i,
  ];
  for (const re of epochContexts) {
    const m = text.match(re);
    if (m) {
      const ms = epochToMs(Number(m[1]));
      if (ms !== undefined && inWindow(ms)) return ms;
    }
  }

  // 2) ISO 8601 timestamp.
  const iso = text.match(
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
  );
  if (iso) {
    const parsed = Date.parse(iso[1].replace(' ', 'T'));
    if (Number.isFinite(parsed) && inWindow(parsed)) return parsed;
  }

  // 3) Relative delay: "retry-after: 30", "try again in 20s", "in 5 minutes".
  const relPatterns = [
    /retry[\s-]?after[:\s]+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)?/i,
    /(?:try again|available again|retry|reset[s]?|wait)\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i,
  ];
  for (const re of relPatterns) {
    const m = text.match(re);
    if (m) {
      const value = Number(m[1]);
      const mult = m[2] ? unitToMs(m[2]) : 1_000; // retry-after defaults to seconds
      if (Number.isFinite(value) && mult !== undefined) {
        const t = now + value * mult;
        if (inWindow(t)) return t;
      }
    }
  }

  // 4) Wall-clock reset time: "resets at 3pm", "reset at 11:30 PM", "resets 18:00".
  const clock = text.match(/reset[a-z]*\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
    || text.match(/reset[a-z]*\s*(?:at\s+)?(\d{1,2}):(\d{2})\b/i);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = clock[2] ? Number(clock[2]) : 0;
    const ampm = clock[3];
    const t = nextClockTime(now, hour, minute, ampm);
    if (t !== undefined && inWindow(t)) return t;
  }

  return undefined;
}

/**
 * Classify `text` (an agent error and/or recent output) as a token-limit
 * failure and, when so, parse the expected reset time.
 */
export function detectTokenLimit(text: string | undefined | null, now: number = Date.now()): TokenLimitInfo {
  if (!isTokenLimitError(text)) return { isLimit: false };
  return { isLimit: true, resetAt: parseResetTime(text as string, now) };
}
