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

/**
 * THE SOCKET PLAN (10 Sep) · there are NO periodic REST polls any more. The
 * server pushes one snapshot a minute (board, account, budget, session,
 * market, contracts, feeds, slots), a partial within 5 s of any write, and
 * one marked final after the close; GET /api/bootstrap seeds the first paint.
 * The reads that remain are ON DEMAND — a candle grain, the session list, a
 * review day — fetched when their inputs change or a snapshot says something
 * moved, never on a timer. (nosecret/nopoll tests assert this.)
 *
 * LIVENESS · the heartbeat (`spread:tick`) is emitted every 10 s from the
 * ticker's own loop. deadAfterMs = 3 × that: TICKER DEAD on every tab, every
 * write button disabled. staleAfterMs: heartbeats arrive but no snapshot for
 * 2.5 × the minute — alive but the board build is wedged.
 */
export const LIVENESS = {
  heartbeatMs: 10_000,
  deadAfterMs: 30_000,
  snapshotMs: 60_000,
  staleAfterMs: 150_000,
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
  // A write must not be cut off by the client while the server is still
  // committing: a 408 after the commit read as a failure and invited a retry
  // that booked it twice. /gates recomputes the board twice on the server.
  '/trading': 30_000,
  '/gates': 30_000,
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
export const BOARD_STALE_MS = LIVENESS.staleAfterMs;
