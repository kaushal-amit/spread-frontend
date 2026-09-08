/**
 * src/api/guards.ts — does a wire payload have the shape src/api/types.ts says?
 *
 * TypeScript checks the fixture against the type at COMPILE time (the
 * contract tests assign each captured body to its type, so a field that is
 * null on the wire but `number` in the type fails `tsc`). These guards do the
 * same at RUNTIME, on the fixture and, if wanted, on a live response: every
 * required key present, every value the declared kind, null only where the
 * type allows it. A guard failure names the key and what was found.
 */
export type Kind = "string" | "number" | "boolean" | "string?" | "number?" | "boolean?" | "array" | "object" | "object?" | "array?";
export type Shape = Record<string, Kind>;

export function check(obj: unknown, shape: Shape, path = "$"): string[] {
  const out: string[] = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [`${path}: expected an object, got ${Array.isArray(obj) ? "array" : typeof obj}`];
  const o = obj as Record<string, unknown>;
  for (const [key, kind] of Object.entries(shape)) {
    const optional = kind.endsWith("?");
    const base = kind.replace("?", "");
    const v = o[key];
    if (!(key in o)) { out.push(`${path}.${key}: missing`); continue; }
    if (v === null || v === undefined) { if (!optional) out.push(`${path}.${key}: null, but the type says ${base}`); continue; }
    const ok = base === "array" ? Array.isArray(v) : base === "object" ? (typeof v === "object" && !Array.isArray(v)) : typeof v === base;
    if (!ok) out.push(`${path}.${key}: expected ${base}, got ${Array.isArray(v) ? "array" : typeof v}`);
    if (base === "number" && typeof v === "number" && !Number.isFinite(v)) out.push(`${path}.${key}: not finite`);
  }
  return out;
}

export const SHAPES = {
  StockCandidate: {
    symbol: "string", price: "number", bid: "number", offer: "number", spread: "number", entryPlacement: "string",
    shares: "number", notionalKd: "number", roundTripKd: "number", netKd: "number", netPerFilKd: "number",
    trendWarn: "boolean", changeFils: "number", changePct: "number", rising: "boolean?",
    status: "string", verdict: "string", failingGatesCount: "number", failingGateNames: "array",
    gateGroups: "array", headroom: "object", market: "string", isDead: "boolean", isOutOfReach: "boolean",
    isStructuralFailure: "boolean", behaviourFlags: "array", metrics: "object", dataQuality: "string",
    notComputed: "array", gateStatsSource: "string?",
  },
  TradingContract: {
    symbol: "string", seq: "number", state: "string", shares: "number", entry: "number?", bid: "number?", offer: "number?",
    committedKd: "number", unrealisedKd: "number?", breakEvenPrice: "number?", targetNormal: "number?",
    targetTrending: "number?", peakSinceFill: "number?", stepDownTime: "string", boughtShares: "number",
    openedOn: "string?", markedAt: "string?", quoteAt: "string?", legs: "array",
  },
  AccountState: {
    buyingPowerKd: "number", investedKd: "number", claimedKd: "number", equityKd: "number", unrealisedKd: "number",
    todayKd: "number", todayTrips: "number", since28JulKd: "number", since28JulFills: "number", netDepositedKd: "number", returnPct: "number",
  },
  Budget: {
    budget_kd: "number", reserve_kd: "number", reserve_held: "boolean", reserve_releases_at_hhmm: "number",
    committed_kd: "number", open_positions: "number", free_kd: "number", min_position_kd: "number", max_price_fils: "number",
  },
  SessionInfo: {
    phase: "string", hour: "number", timeStr: "string", driftVsOpen: "number", minutesToStepDown: "number", lateToOpen: "boolean",
    note: "string", open: "boolean", kuwaitDay: "string", reserveReleased: "boolean", driftByHour: "array", driftMeasured: "boolean",
    stops: "object?",
  },
  SessionStops: {
    day: "string", now: "string", clock: "string", mode: "string", canOpen: "boolean",
    maxTargetTicks: "number?", flatBy: "string", pastFlatBy: "boolean", reasons: "array", market: "object", losses: "object",
  },
  MarketDay: {
    available: "boolean", isToday: "boolean", symbolsTraded: "number", up: "number", down: "number", flat: "number",
    breadthPct: "number", breadth5dAvgPct: "number", regime: "string?", breadthBand: "string?", volumeShares: "number", trades: "number",
    turnoverKd: "number", volumeVs20d: "number", indexYtdPct: "number?", computedAt: "string?",
  },
  Detail: {
    symbol: "string", tradingDay: "string", budgetKd: "number", candidate: "object?", orderBook: "object?", sizing: "object",
    fillTime: "object?", depthSignal: "object", contract: "object?", legs: "array", closedToday: "array", session: "object",
    stop: "object?",
  },
  OrderBook: {
    symbol: "string", bid: "number", bid_qty: "number", offer: "number", offer_qty: "number", last_price: "number", trades: "number",
    bids: "array", offers: "array", dayRange: "object", limitBand: "object", lastTickTime: "string",
  },
  // R-24 · one ladder level. markers is validated separately when present — the
  // key may be absent on a level captured before markers existed, and `check`
  // flags an absent key even for an optional kind.
  BookLevel: { price: "number", qty: "number", changed: "string" },
  LadderMarker: { event: "string", text: "string?" },
  Sizing: {
    symbol: "string", price_fils: "number?", floor_kd: "number", ceiling_kd: "number", suggested_kd: "number?", suggested_shares: "number?",
    your_pct: "number?", net_per_fil_kd: "number?", reachable: "boolean", reasons: "array", basis: "object",
  },
  Stop: { symbol: "string", stopFils: "number?", shelfFils: "number?", reason: "string" },
  Health: {
    status: "string", time: "string", quoteAgeSec: "number?", latestQuoteAt: "string?", latestStatsDay: "string?",
    session: "object", staleAfterSec: "number", note: "string?",
  },
  GateConfig: {
    id: "string", group: "string", gateName: "string", currentValue: "string", numericValue: "number?", unit: "string",
    ruleDescription: "string", evidence: "string", observationCount: "number", confidence: "string", lastChanged: "string",
    configVersion: "number", locked: "boolean", isToggle: "boolean", rejectsCount: "number",
  },
  OrdersFeed: { contracts: "array", summary: "object" },
  OrdersContract: {
    key: "string", symbol: "string", contractDay: "string", seq: "number", state: "string", grossKd: "number?", commissionKd: "number",
    netKd: "number?", fills: "number", executions: "number", heldMinutes: "number?", flags: "array", legs: "array",
  },
  PerformanceDaily: { days: "array", summary: "object" },
  LedgerEntry: { id: "number", at: "string", kind: "string", amount_kd: "number", balance_kd: "number", note: "string?" },
  Candles: { symbol: "string", intervalMinutes: "number", grain: "string", candles: "array" },
  Candle: { time: "string", open: "number", high: "number", low: "number", close: "number", volume: "number" },
  AiHistoryItem: { id: "string", timestamp: "string", text: "string" },
  DetailLeg: {
    id: "number", seq: "number", side: "string", status: "string", price: "number", shares: "number", filledShares: "number?",
    commissionKd: "number?", postedAt: "string?", resolvedAt: "string?", note: "string?", exitVenue: "string?",
  },
} satisfies Record<string, Shape>;
