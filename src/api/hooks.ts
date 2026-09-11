/**
 * src/api/hooks.ts — the live state every page reads.
 *
 * One socket for the whole app (the BOOKS view used to open and close its own
 * on every tab switch). The board arrives on `spread:update` every tick and is
 * seeded by REST so the first paint has data; account, budget, session and
 * market poll on their own cadence and refetch when a board tick arrives.
 *
 * Every hook exposes `error` and `loading`. A page renders those; it never
 * renders an empty list as though it were an answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { apiGet, ApiError, socketOptions, socketUrl } from "./client";
import { POLL_MS, BACKOFF, DEBOUNCE_MS } from "../config/endpoints";
import type { AccountState, BoardUpdate, Budget, MarketDay, SessionInfo, StockCandidate, TradingContract, Detail, AlertMsg, EntryAlertMsg, StrandedMsg, WakeupMsg, HaltMsg, SlotStaleMsg, FeedServerEvent, FeedHealth, Candles } from "./types";
import { kuwaitHHMM } from "../lib/time";
import { requestNotifyOnce, pushNotification, beep } from "../lib/notify";

// ─── the shared socket ─────────────────────────────────────────────────────
let shared: Socket | null = null;
export function getSocket(): Socket {
  if (!shared) shared = io(socketUrl, socketOptions());
  return shared;
}

export interface Live<T> { data: T | null; error: ApiError | Error | null; loading: boolean; at: number | null; refresh: () => void }

/**
 * Poll a GET on an interval, and again (debounced) whenever `signal` changes.
 *
 * Correctness under real conditions is the point here, not just "fetch on a
 * timer". Three hazards a naive version has, and how this avoids them:
 *
 *  · Out-of-order responses. When the inputs change (a symbol switch, a date
 *    pick) the old request can still be in flight and resolve LAST, overwriting
 *    the new resource's data with the old one's. Every request is tagged to a
 *    `gen`; a response from a superseded generation is dropped, and the request
 *    is aborted on cleanup — latest always wins.
 *  · A hung request. A backend that accepts the connection but never answers
 *    would leave a fixed-interval poll stalled forever. The poll self-schedules
 *    (next run only after this one settles) and every request carries a timeout,
 *    so a stall becomes a reported error and the loop keeps going.
 *  · Hammering + duplicates. Consecutive failures back off (everyMs → 2×→4×→8×,
 *    capped, snapping back on success), the signal-driven refetch is debounced,
 *    and a new request aborts any in-flight one — at most one request per hook
 *    is ever open.
 */
function usePolled<T>(path: string, everyMs: number, signal: unknown = null, params?: Record<string, string | number | undefined>, enabled = true): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const key = JSON.stringify(params ?? {});
  const gen = useRef(0);                              // bumped on every param change / unmount
  const inflight = useRef<AbortController | null>(null);
  const fails = useRef(0);
  const lastFetchAt = useRef(0);                      // when the last request was STARTED
  const reschedule = useRef<(() => void) | null>(null); // restart the poll timer from now

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) { setData(null); setLoading(false); return Promise.resolve(); }
    inflight.current?.abort();                        // dedup: one request per hook
    const ctrl = new AbortController();
    inflight.current = ctrl;
    const myGen = gen.current;
    lastFetchAt.current = Date.now();
    return apiGet<T>(path, params, { signal: ctrl.signal })
      .then((d) => { if (gen.current !== myGen) return; setData(d); setError(null); setAt(Date.now()); fails.current = 0; })
      .catch((e) => { if (e?.name === "AbortError" || gen.current !== myGen) return; setError(e); fails.current = Math.min(fails.current + 1, BACKOFF.maxFails); })
      .finally(() => { if (gen.current === myGen) setLoading(false); if (inflight.current === ctrl) inflight.current = null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  // The resource identity is (path, params, enabled) — captured in `refresh`. When
  // it changes, this effect re-runs: bump the generation (so stale in-flight
  // responses are dropped), clear the previous resource's data, show loading, and
  // start a fresh self-scheduling poll with backoff.
  useEffect(() => {
    gen.current += 1;
    const myGen = gen.current;
    setData(null);
    // …and the previous resource's error and timestamp: opening symbol B after
    // symbol A failed showed UNAVAILABLE with A's error while B was loading.
    setError(null); setAt(null);
    setLoading(true);
    fails.current = 0;
    let timer: ReturnType<typeof setTimeout>;
    const delay = () => everyMs * Math.pow(BACKOFF.factor, Math.min(fails.current, BACKOFF.maxDoublings));
    const run = () => {
      refresh().finally(() => {
        if (gen.current !== myGen) return;
        timer = setTimeout(run, delay());
      });
    };
    // A signal-driven refetch RESTARTS the poll clock instead of adding to it.
    reschedule.current = () => {
      if (gen.current !== myGen) return;
      clearTimeout(timer);
      run();
    };
    run();
    return () => { gen.current += 1; clearTimeout(timer); reschedule.current = null; inflight.current?.abort(); inflight.current = null; };
  }, [refresh, everyMs]);

  // Signal-driven refetches (board.tick, every spread:update) — COALESCED, not
  // ADDED. The debounce alone did nothing at the 15 s tick cadence: every tick
  // still re-fired /account, /budget, /trading/contracts and the detail bundle
  // on top of their own polls, which is the frontend's share of the backend
  // OOM. Now a tick only refetches when the last fetch is older than half the
  // poll interval, and when it does it restarts the poll timer, so the cadence
  // is min(everyMs, ticks) — never their sum. The first signal (mount, tick 0)
  // is ignored: the mount poll is already in flight. A background refresh —
  // never clears data or shows loading.
  useEffect(() => {
    if (signal == null || signal === 0) return;
    const t = setTimeout(() => {
      if (Date.now() - lastFetchAt.current < everyMs / 2) return;
      reschedule.current?.();
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [signal, everyMs]);

  return { data, error, loading, at, refresh };
}

// ─── the board ─────────────────────────────────────────────────────────────
export interface Board {
  recommended: StockCandidate[]; nearMiss: StockCandidate[]; rejected: StockCandidate[];
  // SPR-38 · NOT COMPUTED is its own bucket, never counted as rejected.
  notComputed: StockCandidate[];
  all: StockCandidate[]; counts: Record<string, number>; tradingDay: string | null; budgetKd: number | null;
  reach: BoardUpdate["reach"]; stops: BoardUpdate["stops"] | null;
}

export function useBoard(): Live<Board> & { connected: boolean; tick: number; disconnectedSince: number | null } {
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  // SPR-33 · when the push channel dropped, so the UI can say "since HH:MM"
  // instead of leaving a stale board looking live.
  const [disconnectedSince, setDisconnectedSince] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const fromUpdate = (u: BoardUpdate): Board => {
    const notComputed = u.notComputed ?? [];
    return {
      recommended: u.recommended, nearMiss: u.nearMiss, rejected: u.rejected, notComputed,
      all: [...u.recommended, ...u.nearMiss, ...u.rejected, ...notComputed],
      counts: u.counts, tradingDay: u.tradingDay, budgetKd: u.budgetKd, reach: u.reach, stops: u.stops ?? null,
    };
  };

  // Once the socket has delivered a board it is the authoritative source — the
  // REST seed carries no counts/reach/stops and must never overwrite it (doing so
  // blanked the session-banner STOP line after a trade, when board.refresh() was
  // called while the socket was live). The seed exists only for the first paint
  // and as the fallback when the push channel is down.
  const socketSeeded = useRef(false);
  const seedCtrl = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (socketSeeded.current) return;                 // socket is live — it owns the board
    seedCtrl.current?.abort();
    const ctrl = new AbortController();
    seedCtrl.current = ctrl;
    // REST seed: /stocks is every symbol; split by status.
    apiGet<StockCandidate[]>("/stocks", undefined, { signal: ctrl.signal })
      .then((rows) => {
        if (socketSeeded.current) return;             // a push landed while we were fetching
        setData({
          recommended: rows.filter((r) => r.status === "recommended"),
          nearMiss: rows.filter((r) => r.status === "near_miss"),
          rejected: rows.filter((r) => r.status === "rejected"),
          notComputed: rows.filter((r) => r.status === "not_computed"),
          all: rows, counts: {}, tradingDay: null, budgetKd: null, reach: null, stops: null,
        });
        setError(null); setAt(Date.now());
      })
      .catch((e) => { if (e?.name !== "AbortError") setError(e); })
      .finally(() => { setLoading(false); if (seedCtrl.current === ctrl) seedCtrl.current = null; });
  }, []);

  useEffect(() => {
    refresh();
    const s = getSocket();
    const onUpdate = (u: BoardUpdate) => {
      socketSeeded.current = true;
      setData(fromUpdate(u));
      // §0 · a board the server could not compute arrives with `error` set and
      // empty buckets. Surfaced as the board error so the state line reads
      // BOARD UNAVAILABLE — not "0 symbols · live · nothing passes every gate".
      setError(u.error ? new ApiError(503, u.error.code || "BOARD_FAILED", u.error.error || "the board could not be computed") : null);
      setAt(Date.now()); setLoading(false); setTick((t) => t + 1);
    };
    const onErr = (e: any) => setError(new ApiError(0, e?.data?.code || "SOCKET", e?.message || "socket error"));
    const onConnect = () => { setConnected(true); setDisconnectedSince(null); };
    const onDisconnect = () => {
      // The push channel dropped; the socket no longer owns the board, so the REST
      // seed is allowed to fill the gap again until the socket re-delivers.
      socketSeeded.current = false;
      setConnected(false); setDisconnectedSince((prev) => prev ?? Date.now());
    };
    const onSpreadErr = (e: any) => setError(new ApiError(400, e.code, e.error));
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onErr);
    s.on("spread:update", onUpdate);
    s.on("spread:error", onSpreadErr);
    if (s.connected) setConnected(true);
    // Not connected on mount and not yet dropped-from-connected: still mark a
    // start time so a channel that never attaches is visible, not silent.
    else setDisconnectedSince((prev) => prev ?? Date.now());
    return () => {
      // Remove EVERY listener this effect added — the spread:error handler used to
      // leak (added, never removed), stacking a new one on each re-run.
      s.off("connect", onConnect); s.off("disconnect", onDisconnect); s.off("connect_error", onErr);
      s.off("spread:update", onUpdate); s.off("spread:error", onSpreadErr);
      seedCtrl.current?.abort(); seedCtrl.current = null;
    };
  }, [refresh]);

  return { data, error, loading, at, refresh, connected, tick, disconnectedSince };
}

export const useAccount = (signal?: unknown) => usePolled<AccountState>("/account", POLL_MS.account, signal);
export const useBudget = (signal?: unknown) => usePolled<Budget>("/budget", POLL_MS.budget, signal);
export const useSession = () => usePolled<SessionInfo>("/session", POLL_MS.session);

// ─── R-18 · the session picker and review data ──────────────────────────────
export interface SessionRow {
  date: string; symbols_traded: number; pct_advancing: number | null; regime: string | null;
  total_volume: number; total_trades: number; capture_ends_hhmm: number | null; truncated: boolean;
  data_quality: "FULL" | "PARTIAL" | "THIN";
}
export interface ReviewSymbol {
  symbol: string; close_px: number | null; prev_close: number | null; chg_fils: number | null;
  total_volume: number | null; trades: number | null; data_quality: string | null;
}
/** The days that traded and may be selected. Rarely changes — poll slowly. */
export const useSessions = () => usePolled<{ sessions: SessionRow[]; truncated_before_hhmm: number }>("/sessions", POLL_MS.sessions);
/** The raw symbol_day board for a past session (read-only review). */
export const useReviewBoard = (date: string | null, enabled: boolean) =>
  usePolled<{ date: string; count: number; symbols: ReviewSymbol[] }>(
    `/review/session/${date ?? ""}/symbols`, POLL_MS.review, null, undefined, enabled && !!date);
/** R-18 · a date is selectable only if it is today or a day that traded. */
export const isSelectableSession = (date: string, today: string | null, sessionDates: string[]): boolean =>
  date === today || new Set(sessionDates).has(date);
export const useMarket = () => usePolled<MarketDay>("/market", POLL_MS.market);
/** C5 · the chart view: /candles/:symbol at the chosen grain, for the FOCUSED symbol only. */
export const useCandles = (symbol: string | null, minutes: number, date: string | null = null) =>
  usePolled<Candles>(`/candles/${symbol ?? ""}`, POLL_MS.candles, null,
    { minutes, date: date ?? undefined }, !!symbol);
export const useContracts = (signal?: unknown) => usePolled<TradingContract[]>("/trading/contracts", POLL_MS.contracts, signal);

// ─── SPR-30 · the capture-feed roster, so the header can be honest ──────────
// Polls /feeds and also takes the live `spread:feedHealth` push, so a feed
// going silent shows within the scan interval without waiting for the poll.
export function useFeeds(): Live<FeedHealth> {
  const base = usePolled<FeedHealth>("/feeds", POLL_MS.feeds);
  const [data, setData] = useState<FeedHealth | null>(null);
  useEffect(() => { setData(base.data); }, [base.data]);
  useEffect(() => {
    const s = getSocket();
    const onHealth = (m: FeedHealth) => setData(m);
    s.on("spread:feedHealth", onHealth);
    return () => { s.off("spread:feedHealth", onHealth); };
  }, []);
  return { ...base, data };
}

// ─── SPR-07/08 · replay the feed from the server on mount ───────────────────
// The feed was live-socket-only, so a reload lost everything the server had
// recorded. This fetches TODAY's recorded events once; App seeds `feed` with
// them so history survives a reload. Each event keeps its ORIGINAL time.
const feedLevelClass = (level: string): string =>
  level === "hot" ? "hot" : level === "warn" || level === "danger" ? "warn" : "info";
export async function fetchFeedHistory(date?: string): Promise<Array<{ id: string; t: string; s: string; k: string; c: string; u: number; p: string }>> {
  const rows = await apiGet<FeedServerEvent[]>("/feed", date ? { date } : undefined);
  return rows.map((r) => ({
    id: r.id, t: kuwaitHHMM(Date.parse(r.at)), s: r.symbol,
    k: r.title.toUpperCase().slice(0, 40), c: feedLevelClass(r.level), u: 0, p: r.body,
  }));
}

// ─── the detail page ───────────────────────────────────────────────────────

/**
 * One symbol's detail bundle, refreshed every 10 s and on each board tick, with
 * the ladder patched live from `spread:book` (the server pushes only WATCHED
 * symbols, so the hook watches on mount and unwatches on leave — C-06).
 */
export function useDetail(symbol: string | null, tick: number): Live<Detail> & { bookAt: number | null } {
  const base = usePolled<Detail>(`/stocks/${symbol || "_"}/detail`, POLL_MS.detail, symbol ? tick : null, undefined, !!symbol);
  const [data, setData] = useState<Detail | null>(null);
  // When the ladder was last patched by a push — the stale marker reads this.
  const [bookAt, setBookAt] = useState<number | null>(null);
  const lastCapturedAt = useRef<string | null>(null);

  useEffect(() => { setData(base.data); }, [base.data]);
  useEffect(() => { setBookAt(null); lastCapturedAt.current = null; }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    const s = getSocket();
    const sym = symbol.toUpperCase();
    s.emit("spread:watch", { symbol: sym });
    const onBook = (msg: any) => {
      // 4.4 · only THIS symbol's slice; every other push is ignored here.
      if (msg?.symbol !== sym || !msg.book) return;
      // bookAt is "when did a NEW capture arrive", not "when did the server
      // last repeat itself". The server re-sends the latest capture for every
      // watched symbol on every 15 s tick, so stamping every push kept the
      // push age under the stale threshold for ever and the ladder never read
      // STALE while the socket was up — even on a capture hours old. Only a
      // changed capturedAt moves the clock; a push with no capture instant
      // (an empty book) moves nothing.
      const cap = msg.book.capturedAt ?? null;
      // A symbol outside the depth sweep is pushed as {capturedAt:null, b:[], o:[]}
      // every tick; replacing the REST one-level touch ladder with that empty
      // book made the ladder flicker blank/back every 15 s. Nothing captured,
      // nothing to replace.
      if (cap == null && !(msg.book.b || []).length && !(msg.book.o || []).length) return;
      if (cap != null && cap !== lastCapturedAt.current) { lastCapturedAt.current = cap; setBookAt(Date.now()); }
      setData((prev) => prev && prev.orderBook ? {
        ...prev,
        orderBook: {
          ...prev.orderBook,
          bids: (msg.book.b || []).map((l: any[]) => ({ price: Number(l[0]), qty: Number(l[1]), changed: "same" as const })),
          offers: (msg.book.o || []).map((l: any[]) => ({ price: Number(l[0]), qty: Number(l[1]), changed: "same" as const })),
          lastTickTime: msg.book.capturedAt || prev.orderBook.lastTickTime,
        },
      } : prev);
    };
    s.on("spread:book", onBook);
    // The server keeps watches per socket.id and drops them on disconnect. A
    // reconnect is a new id with an empty set — without re-watching, the
    // ladder got no pushes after any reconnect until the view was remounted.
    const onReconnect = () => s.emit("spread:watch", { symbol: sym });
    s.on("connect", onReconnect);
    return () => { s.off("spread:book", onBook); s.off("connect", onReconnect); s.emit("spread:unwatch", { symbol: sym }); };
  }, [symbol]);

  return { ...base, data: symbol ? data : null, bookAt };
}

/** Every alert the server pushes, as feed events. */
export function useAlerts(onAlert: (e: { s: string; k: string; c: string; p: string; u: number }) => void) {
  useEffect(() => {
    const s = getSocket();
    const alert = (m: AlertMsg) => onAlert({ s: m.symbol || "—", k: m.title.toUpperCase().slice(0, 40), c: m.level === "danger" ? "warn" : m.level === "warning" ? "hot" : "info", p: m.body, u: 1 });
    // SPR-06/23 · a depth-vetoed entry is HELD: it belongs in the feed with its
    // reason and the depth context, but it never rings the phone (c:'info', not
    // 'hot'). A clean window is hot as before.
    const entry = (m: EntryAlertMsg) => onAlert(
      m.suppressed
        ? { s: m.symbol, k: `ENTRY HELD · depth ${m.depthSignal ?? "—"}`, c: "info",
            p: m.suppressedReason || `Window open (spread ${m.spreadFils}) but depth ${m.depthSignal ?? "—"} — held off the phone; only a BUY depth alerts.`, u: 1 }
        : { s: m.symbol, k: `ENTRY · SPREAD ${m.spreadFils}`, c: "hot",
            p: `Bid ${m.bidFils} / offer ${m.offerFils}. Offer ${m.offerShares.toLocaleString("en-US")} against your ${m.myShares.toLocaleString("en-US")}; fill ~${m.estFillMins ?? "?"} min${m.depthSignal ? ` · depth ${m.depthSignal}` : ""}.`, u: 1 });
    const stranded = (m: StrandedMsg) => onAlert({ s: m.symbol, k: "STRANDED ORDER", c: "warn", p: `${m.message}${m.options?.length ? " Options: " + m.options.join(" / ") : ""}`, u: 1 });
    const wake = (m: WakeupMsg) => { if (m.flagged?.length) onAlert({ s: "—", k: `WAKE-UP ${m.at}`, c: "hot", p: `${m.flagged.map((f) => f.symbol).join(", ")}${m.lowConfidence ? " — low confidence this early" : ""}`, u: 1 }); };
    // FLOW 6.7 · the halt-resume detector. The RESUME is the loud one — the verdict
    // is already computed and the window is ~2 minutes; a TRADEABLE resume is hot.
    const hp = (m: HaltMsg) => m.resumePriceFils ?? m.resumePrice;
    const halt = (m: HaltMsg) => {
      if (m.phase === "RESUME") {
        const h = m.symbolHistory ?? m.history;
        const hist = h && h.halts ? ` · history: ${h.halts} halt${h.halts === 1 ? "" : "s"}${(h.avgFils ?? h.avgGain) != null ? ` · +${h.avgFils ?? h.avgGain} avg` : ""}` : "";
        const band = m.bandRefFils != null ? ` · band ${m.bandRefFils}` : "";
        // G-4 · NO BUDGET SET is not tradeable, but it is not a quiet warning
        // either — the operator must set a budget to act, so it is hot.
        const noBudget = m.verdict === "NO BUDGET SET";
        onAlert({ s: m.symbol, k: `HALT ${m.direction ?? ""} — ${m.verdict ?? ""}`.trim(), c: (m.tradeable || noBudget) ? "hot" : "warn",
          p: noBudget
            ? `Resumed ${hp(m)}. Gates passed but NO BUDGET SET — set the session budget to size it.${band}${hist}`
            : `Resumed ${hp(m)}. ${m.verdictDetail ?? ""}${m.tradeable ? ` Target ${m.targetFils} · stop ${m.stopFils}.` : ""}${band}${hist}`, u: 1 });
        // A3 · a TRADEABLE resume also raises a browser notification and beeps —
        // the window is two minutes and the tab may be in the background.
        if (m.tradeable) {
          pushNotification(`${m.symbol} — TRADEABLE on resume`, `Resumed ${hp(m)}. Target ${m.targetFils} · stop ${m.stopFils}.`);
          beep();
        }
      } else {
        // G-1 · the swap was APPLIED (or refused) by the backend. Show the
        // outcome; a failed apply is hot — the ladder the halt needs is missing.
        const o = m.slotOutcome;
        const slotLine = o
          ? (o.applied ? ` → slot ${o.slot} (replaced ${o.replaced}).` : ` slot NOT applied — ${o.reason}.`)
          : (m.slotRequest && m.slotRequest.displace != null ? ` Requested a depth slot (drop ${m.slotRequest.displaceSymbol}${m.slotRequest.stale ? ", stale" : ""}).` : "");
        onAlert({ s: m.symbol, k: `HALT DETECTED ${m.direction ?? ""}`.trim(), c: (o && !o.applied) ? "hot" : "info",
          p: `Halted at ${m.haltPrice ?? "?"}.${slotLine} Watch for the resume.`, u: 1 });
      }
    };
    // A4 · a depth slot whose capture has gone stale during the session.
    const slotStale = (m: SlotStaleMsg) => onAlert({ s: m.symbol, k: `SLOT ${m.slot} STALE`, c: "warn",
      p: `No depth capture recently${m.lastCaptureAt ? ` — last ${kuwaitHHMM(m.lastCaptureAt)} Kuwait` : ""}. Its ladder is a stale picture; it will be displaced first.`, u: 1 });
    requestNotifyOnce();
    s.on("spread:alert", alert); s.on("spread:entryAlert", entry); s.on("spread:stranded", stranded); s.on("spread:wakeup", wake); s.on("spread:halt", halt); s.on("spread:slotStale", slotStale);
    return () => { s.off("spread:alert", alert); s.off("spread:entryAlert", entry); s.off("spread:stranded", stranded); s.off("spread:wakeup", wake); s.off("spread:halt", halt); s.off("spread:slotStale", slotStale); };
  }, [onAlert]);
}
