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
import type { AccountState, BoardUpdate, Budget, MarketDay, SessionInfo, StockCandidate, TradingContract, Detail, AlertMsg, EntryAlertMsg, StrandedMsg, WakeupMsg, HaltMsg, SlotStaleMsg, FeedServerEvent, FeedHealth } from "./types";
import { kuwaitHHMM } from "../lib/time";
import { requestNotifyOnce, pushNotification, beep } from "../lib/notify";

// ─── the shared socket ─────────────────────────────────────────────────────
let shared: Socket | null = null;
export function getSocket(): Socket {
  if (!shared) shared = io(socketUrl, socketOptions());
  return shared;
}

export interface Live<T> { data: T | null; error: ApiError | Error | null; loading: boolean; at: number | null; refresh: () => void }

/** Poll a GET on an interval, and again whenever `signal` changes. */
function usePolled<T>(path: string, everyMs: number, signal: unknown = null, params?: Record<string, string | number | undefined>, enabled = true): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const alive = useRef(true);
  const key = JSON.stringify(params ?? {});

  const refresh = useCallback(() => {
    if (!enabled) { setData(null); setLoading(false); return; }
    apiGet<T>(path, params)
      .then((d) => { if (!alive.current) return; setData(d); setError(null); setAt(Date.now()); })
      .catch((e) => { if (!alive.current) return; setError(e); })
      .finally(() => { if (alive.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(refresh, everyMs);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh, everyMs]);

  useEffect(() => { if (signal != null) refresh(); }, [signal, refresh]);

  return { data, error, loading, at, refresh };
}

// ─── the board ─────────────────────────────────────────────────────────────
export interface Board {
  recommended: StockCandidate[]; nearMiss: StockCandidate[]; rejected: StockCandidate[];
  all: StockCandidate[]; counts: Record<string, number>; tradingDay: string | null; budgetKd: number | null;
  reach: BoardUpdate["reach"]; stops: BoardUpdate["stops"] | null;
}

export function useBoard(): Live<Board> & { connected: boolean; tick: number } {
  const [data, setData] = useState<Board | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);

  const fromUpdate = (u: BoardUpdate): Board => ({
    recommended: u.recommended, nearMiss: u.nearMiss, rejected: u.rejected,
    all: [...u.recommended, ...u.nearMiss, ...u.rejected],
    counts: u.counts, tradingDay: u.tradingDay, budgetKd: u.budgetKd, reach: u.reach, stops: u.stops ?? null,
  });

  const refresh = useCallback(() => {
    // REST seed: /stocks is every symbol; split by status.
    apiGet<StockCandidate[]>("/stocks")
      .then((rows) => {
        setData({
          recommended: rows.filter((r) => r.status === "recommended"),
          nearMiss: rows.filter((r) => r.status === "near_miss"),
          rejected: rows.filter((r) => r.status === "rejected"),
          all: rows, counts: {}, tradingDay: null, budgetKd: null, reach: null, stops: null,
        });
        setError(null); setAt(Date.now());
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const s = getSocket();
    const onUpdate = (u: BoardUpdate) => { setData(fromUpdate(u)); setError(null); setAt(Date.now()); setLoading(false); setTick((t) => t + 1); };
    const onErr = (e: any) => setError(new ApiError(0, e?.data?.code || "SOCKET", e?.message || "socket error"));
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", onErr);
    s.on("spread:update", onUpdate);
    s.on("spread:error", (e: any) => setError(new ApiError(400, e.code, e.error)));
    if (s.connected) setConnected(true);
    return () => { s.off("spread:update", onUpdate); s.off("connect_error", onErr); };
  }, [refresh]);

  return { data, error, loading, at, refresh, connected, tick };
}

export const useAccount = (signal?: unknown) => usePolled<AccountState>("/account", 15000, signal);
export const useBudget = (signal?: unknown) => usePolled<Budget>("/budget", 15000, signal);
export const useSession = () => usePolled<SessionInfo>("/session", 30000);

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
export const useSessions = () => usePolled<{ sessions: SessionRow[]; truncated_before_hhmm: number }>("/sessions", 600000);
/** The raw symbol_day board for a past session (read-only review). */
export const useReviewBoard = (date: string | null, enabled: boolean) =>
  usePolled<{ date: string; count: number; symbols: ReviewSymbol[] }>(
    `/review/session/${date ?? ""}/symbols`, 600000, null, undefined, enabled && !!date);
/** R-18 · a date is selectable only if it is today or a day that traded. */
export const isSelectableSession = (date: string, today: string | null, sessionDates: string[]): boolean =>
  date === today || new Set(sessionDates).has(date);
export const useMarket = () => usePolled<MarketDay>("/market", 60000);
export const useContracts = (signal?: unknown) => usePolled<TradingContract[]>("/trading/contracts", 10000, signal);

// ─── SPR-30 · the capture-feed roster, so the header can be honest ──────────
// Polls /feeds and also takes the live `spread:feedHealth` push, so a feed
// going silent shows within the scan interval without waiting for the poll.
export function useFeeds(): Live<FeedHealth> {
  const base = usePolled<FeedHealth>("/feeds", 60000);
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
  const base = usePolled<Detail>(`/stocks/${symbol || "_"}/detail`, 10000, symbol ? tick : null, undefined, !!symbol);
  const [data, setData] = useState<Detail | null>(null);
  // When the ladder was last patched by a push — the stale marker reads this.
  const [bookAt, setBookAt] = useState<number | null>(null);

  useEffect(() => { setData(base.data); }, [base.data]);
  useEffect(() => { setBookAt(null); }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    const s = getSocket();
    const sym = symbol.toUpperCase();
    s.emit("spread:watch", { symbol: sym });
    const onBook = (msg: any) => {
      // 4.4 · only THIS symbol's slice; every other push is ignored here.
      if (msg?.symbol !== sym || !msg.book) return;
      setBookAt(Date.now());
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
    return () => { s.off("spread:book", onBook); s.emit("spread:unwatch", { symbol: sym }); };
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
      p: `No depth capture recently${m.lastCaptureAt ? ` — last ${new Date(m.lastCaptureAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}. Its ladder is a stale picture; it will be displaced first.`, u: 1 });
    requestNotifyOnce();
    s.on("spread:alert", alert); s.on("spread:entryAlert", entry); s.on("spread:stranded", stranded); s.on("spread:wakeup", wake); s.on("spread:halt", halt); s.on("spread:slotStale", slotStale);
    return () => { s.off("spread:alert", alert); s.off("spread:entryAlert", entry); s.off("spread:stranded", stranded); s.off("spread:wakeup", wake); s.off("spread:halt", halt); s.off("spread:slotStale", slotStale); };
  }, [onAlert]);
}
