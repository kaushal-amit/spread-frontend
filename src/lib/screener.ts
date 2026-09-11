/**
 * src/lib/screener.ts — C1/C2 · the screener's client-side filters and columns.
 *
 * PURE. Every predicate reads a field the candidate payload already carries — no
 * threshold is re-derived in the browser (that is the server's job, CR-7), these
 * only SELECT over verdicts and metrics the server already decided. Kept out of
 * the component so the seven filters can be unit-tested without a DOM.
 */
import type { StockCandidate } from "../api/types";

export type ScreenerKey =
  | "ALL" | "PASSES" | "REACHABLE" | "RISING" | "CLEAN_TAPE" | "BOOK" | "NEVER_TRADED";

export interface ScreenerFilterDef {
  key: ScreenerKey;
  /** The chip label; REACHABLE folds in the live slot value. */
  label: string;
  labelFor?: (budgetKd: number | null) => string;
  predicate: (s: StockCandidate) => boolean;
}

const tapeCell = (s: StockCandidate) =>
  s.gateGroups.flatMap((g) => g.cells).find((c) => c.label === "Tape quality");

/**
 * The seven filters, in the reference's order. Each predicate is a plain read:
 *   PASSES EVERY GATE   the server's own 'recommended' bucket (all gates ok)
 *   REACHABLE AT n KD   not out of reach at the live slot (server flag)
 *   RISING 1d+5d        up today and NOT flagged down on 1d/5d (trendWarn)
 *   CLEAN TAPE          Gate 5 passed and not walked-up (server markers)
 *   BOOK CAPTURED       a depth book exists (dataQuality not NO_BOOK/MISSING)
 *   NEVER TRADED        active on 0 of the last sessions (consistencyDays)
 */
export const SCREENER_FILTERS: ScreenerFilterDef[] = [
  { key: "ALL", label: "ALL", predicate: () => true },
  { key: "PASSES", label: "PASSES EVERY GATE", predicate: (s) => s.status === "recommended" },
  {
    key: "REACHABLE", label: "REACHABLE",
    labelFor: (b) => `REACHABLE AT ${b == null ? "—" : Math.round(b)} KD`,
    predicate: (s) => !s.isOutOfReach,
  },
  { key: "RISING", label: "RISING 1d+5d", predicate: (s) => s.rising === true && !s.trendWarn },
  {
    key: "CLEAN_TAPE", label: "CLEAN TAPE",
    predicate: (s) => { const t = tapeCell(s); return !!t && t.ok && !s.metrics.walkedUp; },
  },
  {
    key: "BOOK", label: "BOOK CAPTURED",
    predicate: (s) => s.dataQuality !== "NO_BOOK" && s.dataQuality !== "MISSING",
  },
  // A MEASURED 0 of the last 5 sessions. null (not computed) does not match —
  // it used to, when the presenter turned null into 0 and every NOT COMPUTED
  // symbol read as never traded.
  { key: "NEVER_TRADED", label: "NEVER TRADED", predicate: (s) => s.metrics.consistencyDays === 0 },
];

export function screenerDef(key: ScreenerKey): ScreenerFilterDef {
  return SCREENER_FILTERS.find((f) => f.key === key) ?? SCREENER_FILTERS[0];
}

/** The chip label, with the live slot folded into REACHABLE. */
export function screenerLabel(def: ScreenerFilterDef, budgetKd: number | null): string {
  return def.labelFor ? def.labelFor(budgetKd) : def.label;
}

/** Filter a candidate list by one key. */
export function applyScreener(list: StockCandidate[], key: ScreenerKey): StockCandidate[] {
  return list.filter(screenerDef(key).predicate);
}

/**
 * C2 · the screener row's columns, built ONLY from metrics/headroom already on
 * the candidate. The reference's `5d`, `snaps` and `you%` are NOT on the board
 * payload (they live on the detail bundle), so they are omitted here rather than
 * fabricated — loud over plausible.
 */
/**
 * A NUMBER THAT IS NOT KNOWN IS "—", NEVER 0. The backend sends null for an
 * uncomputed statistic (present.js); with the stats bridge empty this strip
 * used to print "tiny 0% · mv 0 · vol 0×" for every NOT COMPUTED symbol —
 * and 0 is a measurement (0 moves is a dead stock). The 1d change ROUNDS to
 * whole fils like the card (SPR-39: no 0.8999999). "net/fil" is the gross KD
 * per fil of movement (shares / 1000) — it is named so here; the fee-net
 * figure lives on the detail bundle.
 */
export function screenerColumns(s: StockCandidate): { k: string; v: string }[] {
  const m = s.metrics;
  const nn = (n: number | null | undefined) => n == null || Number.isNaN(Number(n));
  const sign = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`;
  const pct = (n: number | null) => (nn(n) ? "—" : `${Math.round(n as number)}%`);
  const num = (n: number | null) => (nn(n) ? "—" : String(n));
  return [
    { k: "px", v: num(s.price) },
    { k: "tick", v: `${m.targetTicks}t` },
    { k: "1d", v: nn(s.changeFils) ? "—" : sign(s.changeFils as number) },
    { k: "tiny", v: pct(m.tapeQualityPct) },
    { k: "mv", v: num(m.movesPerDay) },
    { k: "up2", v: num(m.moves2PlusPerDay) },
    { k: "vol", v: nn(m.volSpikeRatio) ? "—" : `${m.volSpikeRatio}×` },
    { k: "post", v: pct(m.postablePct) },
    { k: "exit", v: pct(m.exitDepthPct) },
    { k: "gross/fil", v: nn(m.netPerFilKd) ? "—" : (m.netPerFilKd as number).toFixed(3) },
    { k: "reach", v: s.headroom?.headroomX ? `${s.headroom.headroomX}×` : "—" },
  ];
}
