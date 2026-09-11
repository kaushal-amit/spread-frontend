/**
 * src/api/snapshot.ts — the terminal's live state, from the socket (the
 * socket plan, 10 Sep).
 *
 * The server pushes ONE `spread:snapshot` a minute — board, account, budget,
 * session, market, contracts, feeds, slots — a PARTIAL within 5 s of any
 * write / halt / wake-up (only the sections it touched), and one marked
 * `final` after the close; it serves the same object over GET /api/bootstrap
 * for the first paint. This store holds the merged sections and hands them
 * to the hooks; NOTHING on the terminal polls for them any more.
 *
 * Loud, not plausible — the liveness reducer:
 *   heartbeat   `spread:tick {seq, at, phase, active, final}` every 10 s FROM
 *               THE TICKER'S OWN LOOP. No heartbeat for DEAD_AFTER_MS →
 *               TICKER DEAD on every tab, buttons disabled. There is no
 *               background REST poll to make a dead server look alive.
 *   missed      the heartbeat's seq runs ahead of the last snapshot received
 *               → ONE bootstrap resync (never a loop).
 *   stale       heartbeats arrive but no snapshot for STALE_AFTER_MS while the
 *               ticker says it is active → "alive but the board is stale" —
 *               a wedged board build, distinct from a dead process.
 *   closed      the last snapshot was `final` (or the heartbeat says so) →
 *               CLOSED, not LIVE and not STALE.
 * A section that the server could not build arrives as { error } and is
 * reported by that section's hook — never a quiet empty value.
 */
import { useSyncExternalStore, useEffect, useState } from "react";
import { apiGet, ApiError } from "./client";
import { getSocket } from "./socket";
import { LIVENESS } from "../config/endpoints";
import type { BoardUpdate, AccountState, Budget, SessionInfo, MarketDay, TradingContract, FeedHealth } from "./types";

export type Section = "board" | "account" | "budget" | "session" | "market" | "contracts" | "feeds" | "slots";
export const SECTIONS: Section[] = ["board", "account", "budget", "session", "market", "contracts", "feeds", "slots"];
export interface SectionError { error: { code: string; error: string } }
export interface SlotList { symbols: { slot: number; symbol: string; code: string | null }[]; trading_date: string; slotCount?: number }

export interface SnapshotMsg {
  seq: number; at: string; tradingDay: string; budgetKd: number | null;
  partial: boolean; parts: Section[]; final: boolean; reason: string | null;
  board?: BoardUpdate | SectionError; account?: AccountState | SectionError; budget?: Budget | SectionError;
  session?: SessionInfo | SectionError; market?: MarketDay | SectionError; contracts?: TradingContract[] | SectionError;
  feeds?: FeedHealth | SectionError; slots?: SlotList | SectionError;
}
export interface Heartbeat { seq: number; at: string; phase: string; active: boolean; final: boolean }

export interface SnapshotState {
  sections: Partial<Record<Section, unknown>>;   // merged, latest per section
  sectionAt: Partial<Record<Section, number>>;    // client ms when each section last arrived
  seq: number;                                    // the last snapshot's seq
  tradingDay: string | null; budgetKd: number | null;
  final: boolean;
  lastSnapshotAt: number | null;                  // client ms
  lastPartialSeq: number;                         // the last PARTIAL's seq — a write happened
  heartbeat: Heartbeat | null; lastHeartbeatAt: number | null;
  connected: boolean; disconnectedSince: number | null;
  bootstrapping: boolean; bootstrapError: ApiError | Error | null; bootstraps: number;
}

let state: SnapshotState = {
  sections: {}, sectionAt: {}, seq: 0, tradingDay: null, budgetKd: null, final: false,
  lastSnapshotAt: null, lastPartialSeq: 0, heartbeat: null, lastHeartbeatAt: null,
  connected: false, disconnectedSince: null, bootstrapping: false, bootstrapError: null, bootstraps: 0,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SnapshotState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const getState = () => state;
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** A section the server could not BUILD is exactly { error: { code, error } } — nothing else in it.
 *  (A board that computed but carries its own `error` field beside the buckets is not that.) */
export const isSectionError = (v: unknown): v is SectionError =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 1 && "error" in (v as object)
  && typeof (v as SectionError).error === "object" && (v as SectionError).error !== null && "code" in (v as SectionError).error;

/** Merge a snapshot: a full one replaces every section; a partial only its parts. */
export function applySnapshot(m: SnapshotMsg, now = Date.now()): void {
  const sections = m.partial ? { ...state.sections } : {};
  const sectionAt = m.partial ? { ...state.sectionAt } : {};
  for (const p of m.parts) { sections[p] = (m as unknown as Record<string, unknown>)[p]; sectionAt[p] = now; }
  set({
    sections, sectionAt, seq: Math.max(state.seq, m.seq), tradingDay: m.tradingDay ?? state.tradingDay,
    budgetKd: m.budgetKd ?? state.budgetKd,
    final: m.final ? true : (m.partial ? state.final : false),
    lastSnapshotAt: now,
    lastPartialSeq: m.partial ? m.seq : state.lastPartialSeq,
    bootstrapError: null,
  });
}
export function applyHeartbeat(h: Heartbeat, now = Date.now()): void {
  set({ heartbeat: h, lastHeartbeatAt: now });
}

let bootstrapInflight: Promise<void> | null = null;
/** GET /api/bootstrap — the same object the socket pushes. Once on mount, once per missed seq. */
export function bootstrap(reason = "mount"): Promise<void> {
  if (bootstrapInflight) return bootstrapInflight;
  set({ bootstrapping: true });
  bootstrapInflight = apiGet<SnapshotMsg>("/bootstrap")
    .then((m) => { applySnapshot({ ...m, partial: false, parts: SECTIONS.filter((s) => s in m), reason: reason }); })
    .catch((e) => { if (e?.name !== "AbortError") set({ bootstrapError: e }); })
    .finally(() => { set({ bootstrapping: false, bootstraps: state.bootstraps + 1 }); bootstrapInflight = null; });
  return bootstrapInflight;
}

let attached = false;
/** Attach the socket listeners once and run the first bootstrap. Idempotent. */
export function attach(): void {
  if (attached) return;
  attached = true;
  const s = getSocket();
  s.on("spread:snapshot", (m: SnapshotMsg) => applySnapshot(m));
  s.on("spread:tick", (h: Heartbeat) => applyHeartbeat(h));
  s.on("connect", () => set({ connected: true, disconnectedSince: null }));
  s.on("disconnect", () => set({ connected: false, disconnectedSince: state.disconnectedSince ?? Date.now(), heartbeat: null }));
  if (s.connected) set({ connected: true }); else set({ disconnectedSince: state.disconnectedSince ?? Date.now() });
  bootstrap("mount");
}
/** Tests only. */
export function _reset(): void {
  state = { sections: {}, sectionAt: {}, seq: 0, tradingDay: null, budgetKd: null, final: false,
    lastSnapshotAt: null, lastPartialSeq: 0, heartbeat: null, lastHeartbeatAt: null,
    connected: false, disconnectedSince: null, bootstrapping: false, bootstrapError: null, bootstraps: 0 };
  attached = false; bootstrapInflight = null; resyncedForSeq = 0;
  listeners.forEach((l) => l());
}

export function useSnapshotState(): SnapshotState {
  useEffect(() => { attach(); }, []);
  return useSyncExternalStore(subscribe, getState, getState);
}

// ─── liveness ───────────────────────────────────────────────────────────────
export type LiveMode = "live" | "dead" | "stale" | "closed" | "disconnected" | "connecting";
export interface Liveness {
  mode: LiveMode;
  dead: boolean;            // no heartbeat for DEAD_AFTER_MS — buttons disabled everywhere
  stale: boolean;           // heartbeats arrive, no snapshot for STALE_AFTER_MS while active
  closed: boolean;          // the final snapshot has been received
  connected: boolean;
  since: number | null;     // client ms the current bad state began (dead/stale/disconnected)
  heartbeatAgeSec: number | null; snapshotAgeSec: number | null;
  seq: number; heartbeatSeq: number | null;
  reason: string;           // the sentence the banner shows
}

let resyncedForSeq = 0;
export function computeLiveness(s: SnapshotState, now = Date.now()): Liveness {
  const hbAge = s.lastHeartbeatAt == null ? null : now - s.lastHeartbeatAt;
  const snapAge = s.lastSnapshotAt == null ? null : now - s.lastSnapshotAt;
  const heartbeatSeq = s.heartbeat?.seq ?? null;
  const base = { connected: s.connected, heartbeatAgeSec: hbAge == null ? null : Math.round(hbAge / 1000),
    snapshotAgeSec: snapAge == null ? null : Math.round(snapAge / 1000), seq: s.seq, heartbeatSeq };
  if (!s.connected) {
    // Never connected yet vs dropped: both are "not live", worded apart.
    const never = s.lastHeartbeatAt == null && s.lastSnapshotAt == null;
    return { ...base, mode: never ? "connecting" : "disconnected", dead: !never, stale: false, closed: false,
      since: s.disconnectedSince, reason: never ? "connecting to the ticker…" : "LIVE FEED LOST — reconnecting; showing the last update, not live" };
  }
  // Connected: the heartbeat is the proof of life. Grace from the connect until the first one.
  const firstGrace = s.lastHeartbeatAt == null && (s.disconnectedSince == null || now - (s.lastSnapshotAt ?? now) < LIVENESS.deadAfterMs);
  if (hbAge != null && hbAge > LIVENESS.deadAfterMs) {
    return { ...base, mode: "dead", dead: true, stale: false, closed: false, since: s.lastHeartbeatAt! + LIVENESS.deadAfterMs,
      reason: `TICKER DEAD — no heartbeat for ${Math.round(hbAge / 1000)}s; the server is not feeding this terminal. Nothing here is live and no button will write.` };
  }
  if (s.lastHeartbeatAt == null && !firstGrace) {
    return { ...base, mode: "dead", dead: true, stale: false, closed: false, since: s.disconnectedSince,
      reason: "TICKER DEAD — connected but no heartbeat has arrived; the server is not feeding this terminal." };
  }
  const closed = s.final || !!s.heartbeat?.final;
  if (closed) {
    return { ...base, mode: "closed", dead: false, stale: false, closed: true, since: null,
      reason: `SESSION CLOSED · final snapshot ${s.tradingDay ?? ""} seq ${s.seq}` };
  }
  const active = s.heartbeat?.active ?? true;
  if (active && snapAge != null && snapAge > LIVENESS.staleAfterMs) {
    return { ...base, mode: "stale", dead: false, stale: true, closed: false, since: s.lastSnapshotAt! + LIVENESS.staleAfterMs,
      reason: `ticker alive, board stale — no snapshot for ${Math.round(snapAge / 1000)}s (heartbeat ${Math.round((hbAge ?? 0) / 1000)}s ago); the board build is wedged` };
  }
  return { ...base, mode: "live", dead: false, stale: false, closed: false, since: null, reason: "" };
}

/** Missed-snapshot resync: the heartbeat's seq is ahead of the last snapshot → ONE bootstrap per gap. */
export function maybeResync(s: SnapshotState): boolean {
  const hb = s.heartbeat?.seq ?? 0;
  if (hb > s.seq && hb !== resyncedForSeq && !s.bootstrapping) {
    resyncedForSeq = hb;
    bootstrap(`missed snapshot ${s.seq} → ${hb}`);
    return true;
  }
  return false;
}

/** The liveness verdict, re-evaluated every second. Every tab renders from this one source. */
export function useLiveness(): Liveness {
  const s = useSnapshotState();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { maybeResync(s); }, [s.heartbeat?.seq, s.seq, s.bootstrapping]); // eslint-disable-line react-hooks/exhaustive-deps
  return computeLiveness(s, now);
}
