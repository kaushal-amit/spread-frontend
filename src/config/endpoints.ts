/**
 * src/config/endpoints.ts — ONE home for every network cadence, timeout and
 * backoff constant.
 *
 * These were literals scattered across client.ts (the 12 s timeout), hooks.ts
 * (eight poll intervals, the backoff doublings, the 1.2 s debounce) and
 * TodayView.tsx (the 120 s board-stale threshold). A number tuned in one place
 * and forgotten in another is how two timeouts drift apart; keeping them here
 * makes the whole request budget legible and changeable in one edit.
 */

/** Poll intervals, per resource (ms). The hook names map one-to-one. */
export const POLL_MS = {
  account: 15_000,
  budget: 15_000,
  session: 30_000,
  market: 60_000,
  contracts: 10_000,
  feeds: 60_000,
  detail: 10_000,
  sessions: 600_000,
  review: 600_000,
} as const;

/**
 * Per-endpoint request timeouts (ms). A fast read gets a short leash; the whole
 * board, a full past session, and the model call legitimately take longer, and a
 * single global timeout either cuts those off or lets a truly hung fast read sit
 * for far too long. `default` applies to anything unlisted. Matched by path
 * PREFIX, longest hit wins, so `/stocks/:sym/detail` can differ from `/stocks`.
 */
export const TIMEOUT_MS: Record<string, number> = {
  default: 12_000,
  '/stocks/': 15_000,   // a symbol detail bundle
  '/stocks': 15_000,    // the whole board seed
  '/review': 20_000,    // a full past session
  '/sessions': 20_000,
  '/ai/ask': 30_000,    // the model call is slow by nature
  '/feed': 12_000,
};

/** The request timeout for a path — the longest matching prefix, else default. */
export function timeoutFor(path: string): number {
  let best = TIMEOUT_MS.default;
  let bestLen = -1;
  for (const [prefix, ms] of Object.entries(TIMEOUT_MS)) {
    if (prefix === 'default') continue;
    if (path.startsWith(prefix) && prefix.length > bestLen) { best = ms; bestLen = prefix.length; }
  }
  return best;
}

/**
 * Backoff for a polling hook after consecutive failures: everyMs × factor^n,
 * where n is capped at maxDoublings, and the failure counter itself is capped at
 * maxFails so it never overflows. Snaps back to everyMs on the first success.
 */
export const BACKOFF = { factor: 2, maxDoublings: 3, maxFails: 6 } as const;

/** Coalesce signal-driven refetches to one, this long after the last tick (ms). */
export const DEBOUNCE_MS = 1_200;

/** The board reads STALE when the last socket update is older than this (ms). */
export const BOARD_STALE_MS = 120_000;
