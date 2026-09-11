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
import { apiGet, ApiError } from "./client";
import { BACKOFF, DEBOUNCE_MS } from "../config/endpoints";
import type { AccountState, BoardUpdate, Budget, MarketDay, SessionInfo, StockCandidate, TradingContract, Detail, AlertMsg, EntryAlertMsg, StrandedMsg, WakeupMsg, HaltMsg, SlotStaleMsg, FeedServerEvent, FeedHealth, Candles } from "./types";
import { kuwaitHHMM } from "../lib/time";
import { requestNotifyOnce, pushNotification, beep } from "../lib/notify";
import { getSocket } from "./socket";
import { useSnapshotState, isSectionError, bootstrap, type Section } from "./snapshot";
export { getSocket } from "./socket";

export interface Live<T> { data: T | null; error: ApiError | Error | null; loading: boolean; at: number | null; refresh: () => void }

/**
 * An ON-DEMAND read (the socket plan): fetched when its inputs change and,
 * debounced, whenever `signal` changes. With everyMs <= 0 (the default now)
 * there is NO timer — nothing on the terminal polls; the remaining callers
 * are the candle grain, the session list and a review day, re-read when a
 * snapshot says something moved. everyMs > 0 keeps the old self-scheduling
 * poll for a caller that explicitly wants one (none today; a test asserts it).
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
function usePolled<T>(path: string, everyMs: number = 0, signal: unknown = null, params?: Record<string, string | number | undefined>, enabled = true): Live<T> {
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
        if (everyMs > 0) timer = setTimeout(run, delay());   // on demand: no timer
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
      if (everyMs > 0 && Date.now() - lastFetchAt.current < everyMs / 2) return;
      reschedule.current?.();
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [signal, everyMs]);

  return { data, error, loading, at, refresh };
}

// ─── sections of the snapshot, as Live<T> ────────────────────────────────────
/**
 * One section of the server's snapshot as the Live<T> shape the components
 * already render: data (null while a section is broken), error (the server's
 * per-section error, as an ApiError), loading (no snapshot yet), at (when the
 * section last arrived), refresh (a bootstrap — the same object, on demand).
 */
function useSection<T>(name: Section): Live<T> {
  const st = useSnapshotState();
  const raw = st.sections[name];
  const broken = isSectionError(raw);
  const data = raw === undefined || broken ? null : (raw as T);
  const error: ApiError | Error | null = broken
    ? new ApiError(503, raw.error.code || "SECTION_FAILED", raw.error.error || `${name} could not be built`)
    : (raw === undefined && st.bootstrapError) ? st.bootstrapError : null;
  return { data, error, loading: raw === undefined && !st.bootstrapError && (st.bootstrapping || st.lastSnapshotAt == null),
    at: st.sectionAt[name] ?? null, refresh: () => { bootstrap("refresh"); } };
}

// ─── the board ─────────────────────────────────────────────────────────────
export interface Board {
  // CR-8 · the four verdict buckets + NOT COMPUTED; `all` is their concatenation
  // and equals counts.universe — or the server said UNIVERSE_MISMATCH.
  take: StockCandidate[]; oneAway: StockCandidate[]; priceWarn: StockCandidate[]; leave: StockCandidate[];
  /** @deprecated = take */ recommended: StockCandidate[];
  /** @deprecated = oneAway */ nearMiss: StockCandidate[];
  /** @deprecated = priceWarn + leave */ rejected: StockCandidate[];
  // SPR-38 · NOT COMPUTED is its own bucket, never counted as rejected.
  notComputed: StockCandidate[];
  all: StockCandidate[]; counts: Record<string, number>; tradingDay: string | null; budgetKd: number | null;
  reach: BoardUpdate["reach"]; stops: BoardUpdate["stops"] | null;
  // F11 · the wake-ups: a list, null when the scan could not run, undefined from a pre-F11 server.
  wakeups?: BoardUpdate["wakeups"];
}

export function useBoard(): Live<Board> & { connected: boolean; tick: number; disconnectedSince: number | null } {
  const st = useSnapshotState();
  const base = useSection<BoardUpdate>("board");
  const u = base.data;
  // §0 · a board the server could not compute arrives with `error` set and
  // empty buckets — the state line reads BOARD UNAVAILABLE, never a quiet
  // "0 symbols · nothing passes every gate".
  const boardError = u?.error ? new ApiError(503, u.error.code || "BOARD_FAILED", u.error.error || "the board could not be computed") : base.error;
  const data: Board | null = u ? (() => {
    const notComputed = u.notComputed ?? [];
    // CR-8 · read the buckets; a pre-CR-8 server (one release) sends only the
    // old names — split them by `bucket` when present, else by status.
    const take = u.take ?? u.recommended;
    const oneAway = u.oneAway ?? u.nearMiss;
    const priceWarn = u.priceWarn ?? u.rejected.filter((r) => r.bucket === "PRICE_WARN" || r.status === "price_warn");
    const leave = u.leave ?? u.rejected.filter((r) => !(r.bucket === "PRICE_WARN" || r.status === "price_warn"));
    return {
      take, oneAway, priceWarn, leave, notComputed,
      recommended: take, nearMiss: oneAway, rejected: [...priceWarn, ...leave],
      all: [...take, ...oneAway, ...priceWarn, ...leave, ...notComputed],
      counts: u.counts, tradingDay: u.tradingDay, budgetKd: u.budgetKd, reach: u.reach, stops: u.stops ?? null,
      wakeups: u.wakeups,
    };
  })() : null;
  // `tick` — a write happened (the last PARTIAL's seq): the detail bundle re-reads on it.
  return { data, error: boardError, loading: base.loading, at: base.at, refresh: base.refresh,
    connected: st.connected, tick: st.lastPartialSeq, disconnectedSince: st.disconnectedSince };
}

// The socket plan · these are SECTIONS of the snapshot. No polling: a write
// pushes a partial within 5 s, the minute pushes the rest.
export const useAccount = (_signal?: unknown) => useSection<AccountState>("account");
export const useBudget = (_signal?: unknown) => useSection<Budget>("budget");
export const useSession = () => useSection<SessionInfo>("session");

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
/** The days that traded and may be selected. On demand: once, and again after a final snapshot (a new session recorded). */
export function useSessions() {
  const st = useSnapshotState();
  return usePolled<{ sessions: SessionRow[]; truncated_before_hhmm: number }>("/sessions", 0, st.final ? st.seq : null);
}
/** The raw symbol_day board for a past session (read-only review). Once per date. */
export const useReviewBoard = (date: string | null, enabled: boolean) =>
  usePolled<{ date: string; count: number; symbols: ReviewSymbol[] }>(
    `/review/session/${date ?? ""}/symbols`, 0, null, undefined, enabled && !!date);
/** R-18 · a date is selectable only if it is today or a day that traded. */
export const isSelectableSession = (date: string, today: string | null, sessionDates: string[]): boolean =>
  date === today || new Set(sessionDates).has(date);
export const useMarket = () => useSection<MarketDay>("market");
/** C5 · the chart view: /candles/:symbol at the chosen grain, for the FOCUSED symbol only — re-read on each minute snapshot, never on a timer. */
export function useCandles(symbol: string | null, minutes: number, date: string | null = null) {
  const st = useSnapshotState();
  return usePolled<Candles>(`/candles/${symbol ?? ""}`, 0, st.seq || null, { minutes, date: date ?? undefined }, !!symbol);
}
export const useContracts = (_signal?: unknown) => useSection<TradingContract[]>("contracts");

// ─── SPR-30 · the capture-feed roster, so the header can be honest ──────────
// Polls /feeds and also takes the live `spread:feedHealth` push, so a feed
// going silent shows within the scan interval without waiting for the poll.
export function useFeeds(): Live<FeedHealth> {
  const base = useSection<FeedHealth>("feeds");
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
 * One symbol's detail bundle — read ONCE per symbol and again after a write
 * (`tick` = the last partial snapshot's seq) — with the ladder, the quote and
 * the open contract's marks patched live from `spread:focus`: the server
 * pushes the FOCUSED symbol every 2 s when something changed. No 10 s poll.
 * The hook tells the server which symbol it is looking at (`spread:focus`),
 * clears it on leave, and re-tells it on every (re)connect — the server keeps
 * the focus per socket.id and a reconnect is a new id.
 */
export interface FocusMsg {
  symbol: string; at: string;
  quote: { last: number | null; bid: number | null; bidQty: number | null; offer: number | null; offerQty: number | null; at: string } | null;
  book: { capturedAt: string | null; b: [number, number, number | null][]; o: [number, number, number | null][] };
  contract: TradingContract | null;
}
export function useDetail(symbol: string | null, tick: number): Live<Detail> & { bookAt: number | null; focusAt: number | null; focus: FocusMsg | null } {
  const base = usePolled<Detail>(`/stocks/${symbol || "_"}/detail`, 0, symbol ? tick : null, undefined, !!symbol);
  const [data, setData] = useState<Detail | null>(null);
  const [focus, setFocus] = useState<FocusMsg | null>(null);
  // When the ladder was last patched by a NEW capture — the stale marker reads this.
  const [bookAt, setBookAt] = useState<number | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const lastCapturedAt = useRef<string | null>(null);

  useEffect(() => { setData(base.data); }, [base.data]);
  useEffect(() => { setBookAt(null); setFocusAt(null); setFocus(null); lastCapturedAt.current = null; }, [symbol]);

  useEffect(() => {
    if (!symbol) { getSocket().emit("spread:focus", { symbol: null }); return; }
    const s = getSocket();
    const sym = symbol.toUpperCase();
    s.emit("spread:focus", { symbol: sym });
    const onFocus = (msg: FocusMsg) => {
      // 4.4 · only THIS symbol's slice; every other push is ignored here.
      if (msg?.symbol !== sym) return;
      setFocus(msg); setFocusAt(Date.now());
      const book = msg.book;
      // bookAt is "when did a NEW capture arrive". Only a changed capturedAt
      // moves the clock; a push with no capture instant (an empty book) moves
      // nothing and does not replace the REST touch ladder.
      const cap = book?.capturedAt ?? null;
      if (!book || (cap == null && !(book.b || []).length && !(book.o || []).length)) return;
      if (cap != null && cap !== lastCapturedAt.current) { lastCapturedAt.current = cap; setBookAt(Date.now()); }
      setData((prev) => prev && prev.orderBook ? {
        ...prev,
        orderBook: {
          ...prev.orderBook,
          bids: (book.b || []).map((l) => ({ price: Number(l[0]), qty: Number(l[1]), changed: "same" as const })),
          offers: (book.o || []).map((l) => ({ price: Number(l[0]), qty: Number(l[1]), changed: "same" as const })),
          lastTickTime: cap || prev.orderBook.lastTickTime,
        },
      } : prev);
    };
    s.on("spread:focus", onFocus);
    const onReconnect = () => s.emit("spread:focus", { symbol: sym });
    s.on("connect", onReconnect);
    return () => { s.off("spread:focus", onFocus); s.off("connect", onReconnect); s.emit("spread:focus", { symbol: null }); };
  }, [symbol]);

  return { ...base, data: symbol ? data : null, bookAt, focusAt, focus };
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
