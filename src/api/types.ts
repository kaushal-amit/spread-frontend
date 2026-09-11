/**
 * src/api/types.ts — the shapes the backend's presenters emit.
 *
 * Mirrors be/src/api/present.js field for field. Nothing is renamed on the
 * client: a translation layer is one more place to get a name wrong, and a
 * mismatched name is a silent `undefined` rather than an error — which is how
 * BooksView read `.open` from a bare array for a month.
 */
/**
 * CR-7 · the server-formatted verdict for a gate cell: "<value> <cmp>
 * <threshold> — PASS/FAIL/WARN", decided by the funnel where the threshold and
 * the comparator live. The browser PRINTS `text`; it never re-derives the
 * verdict (it has neither the threshold nor the comparator). `computed:false`
 * means the gate failed for want of a number — shown as NOT COMPUTED, not FAIL.
 */
export interface GateCheck {
  text: string; verdict: 'PASS' | 'FAIL' | 'WARN' | 'NOT_COMPUTED';
  ok: boolean; warn: boolean; computed: boolean;
  actual: string | null; cmp: string; threshold: string;
}
export interface GateCell { label: string; ok: boolean; warn: boolean; value: string; sub: string; rawNumber?: number; check?: GateCheck | null }
export interface GateGroup { groupName: string; cells: GateCell[] }
export interface BehaviourFlag { flag: string; icon: string; label: string; why: string }

export type Verdict = 'TRADABLE' | 'NEAR_MISS' | 'NOT_RECOMMENDED' | 'REJECTED' | 'OUT_OF_REACH' | 'DEAD';
export type Status = 'recommended' | 'near_miss' | 'price_warn' | 'rejected' | 'not_computed';
/** CR-8 · the four verdict buckets + NOT COMPUTED. Every instrument is in exactly one; nothing is removed. */
export type Bucket = 'TAKE' | 'ONE_AWAY' | 'PRICE_WARN' | 'LEAVE' | 'NOT_COMPUTED';
export type StructuralReason = 'OUT_OF_REACH' | 'BELOW_TICK' | 'INFEASIBLE_TARGET' | 'SUSPENDED';

/**
 * A NUMBER THAT IS NOT KNOWN TRAVELS AS NULL, NEVER AS 0 (backend present.js).
 * Every measured field below may be null while the statistic is uncomputed —
 * render "—", never a zero that reads as a measurement.
 */
export type Num = number | null;

export interface StockCandidate {
  symbol: string; nameAr?: string;
  price: Num; bid: Num; offer: Num; spread: Num;
  entryPlacement: 'INSIDE' | 'AT_BID';
  shares: Num; notionalKd: Num; roundTripKd: Num; netKd: Num; netPerFilKd: Num;
  trendWarn: boolean; changeFils: Num; changePct: Num; rising: boolean | null;
  status: Status; verdict: Verdict;
  /** CR-8 · decided server-side (screening.js bucketize). */
  bucket: Bucket;
  /** PRICE WARN only: the smallest tick move that nets the floor at this budget; null = none under 12 fils. */
  needsFils?: number | null;
  /** Why a LEAVE row is folded: measured, non-overridable. null for an ordinary row. */
  structuralReason: StructuralReason | null;
  /** The ABAR line: no symbol_day row for the screen day; lastRowDay names the last one. */
  noRow: boolean;
  lastRowDay: string | null;
  failingGatesCount: number; failingGateNames: string[]; rejectionDetail?: string;
  gateGroups: GateGroup[]; takeItBecause?: string; careful?: string;
  headroom: { minKd: Num; maxKd: Num; profitPerFil: Num; currentKd: Num; headroomX: Num };
  market: string; marketVerified: boolean;
  isDead: boolean; isOutOfReach: boolean; isStructuralFailure: boolean;
  behaviourFlags: BehaviourFlag[];
  metrics: {
    priceFils: Num; netKd: Num; netPerFilKd: Num; tradeSizeShares: Num; movesPerDay: Num;
    moves2PlusPerDay: Num; tapeQualityPct: Num; tapeQualityUpPct: Num; postablePct: Num; exitDepthPct: Num;
    volSpikeRatio: Num; outwardBlockFlowRatio: Num; consistencyDays: Num; gapPresentPct: Num;
    dailyRangeFils: Num; targetTicks: number;
    // R-06 · the walked-up marker, decided by the server (funnel gate 5), never recomputed here.
    walkedUp?: boolean;
    // A5 · the 09:00–09:45 range-over-cost. A ranking column, NOT a gate: null
    // before the 09:45 job (shown as "—"); m45Reason carries THIN for the tooltip.
    m45?: number | null; m45Reason?: string | null;
  };
  dataQuality: 'OK' | 'PARTIAL' | 'THIN' | 'MISSING' | 'NO_BOOK';
  dataQualityPct?: number;
  /** Measured server-side (screening.js): any spread.order_leg row for the symbol, EVER. null = not measured. */
  everTraded: boolean | null;
  /** Measured server-side: at least one depth capture for the symbol on the board day. null = not measured. */
  bookCapturedToday: boolean | null;
  /** Gates that failed for want of a NUMBER, not for want of a stock. */
  notComputed: string[];
  gateStatsSource: 'SCRAPER' | 'BACKEND_BRIDGE' | null;
  // R-25 · FLOW step 4 checks 1-2, computed server-side from today's open/last/high.
  // Distinct from `trendWarn` (the yesterday-based DIRECTION warn-gate).
  liveDirection?: {
    computed: boolean; currentAboveOpen: boolean | null; highAboveOpen: boolean | null;
    openFils?: number; lastFils?: number; highFils?: number; note: string;
  } | null;
}

export interface Leg {
  id: number; contractId: number; symbol: string; time: string; side: 'BUY' | 'SELL';
  status: string; price: number; shares: number; filledShares?: number | null; commission_kd: number; note: string;
  // F1 · 'POSTED' = the rest of a partial fill is still queued (restingShares of it). null = whole / not tracked.
  restStatus?: 'POSTED' | 'FILLED' | 'CANCELLED' | null; restingShares?: number;
  isOverride?: boolean;
}
/**
 * A contract. Since Step 3.8 a number the server does not KNOW is null, never
 * 0 and never the entry wearing the bid's name: `bid`, `unrealisedKd`,
 * `peakSinceFill` is null when no quote has printed
 * today (`markedAt: 'entry'`); a claim (`state: 'picked'`) has no entry and
 * no break-even. A page renders null as "—" or says why, never as 0.
 */
export interface TradingContract {
  symbol: string; seq: number; state: 'picked' | 'holding' | 'carried';
  shares: number; entry: number | null; bid: number | null; offer: number | null;
  committedKd: number; unrealisedKd: number | null;
  breakEvenPrice: number | null;
  // R-41 · the exit target (FLOW step 7): +2 fils normally, +6 on a trending day. The trailing offer is gone.
  targetNormal: number | null; targetTrending: number | null; peakSinceFill: number | null;
  stepDownTime: string; boughtShares: number; openedOn: string | null;
  markedAt: 'quote' | 'entry' | null; quoteAt: string | null;
  // F2 · the stop RECORDED at the fill (fixed); stopHitAt once the bid printed through it.
  stopFils?: number | null; stopHitAt?: string | null;
  // F1 · PART FILLED: the buy's remainder still queued (0 when whole).
  restingBuyShares?: number;
  legs: Leg[];
}

export interface AccountState {
  buyingPowerKd: number; investedKd: number; claimedKd: number; equityKd: number; unrealisedKd: number;
  todayKd: number; todayTrips: number; since28JulKd: number; since28JulFills: number;
  netDepositedKd: number; returnPct: number;
}

export interface Budget {
  budget_kd: number; reserve_kd: number; reserve_held: boolean; reserve_releases_at_hhmm: number;
  committed_kd: number; open_positions: number; free_kd: number; min_position_kd: number; max_price_fils: number;
  // F7 · the snapshot's fits line: the TAKE cards against free_kd (sizing.fits). Absent on a REST /budget read.
  fits?: { freeKd: number | null; remainingKd?: number; line: string; items: { symbol: string; needKd: number | null; computed: boolean; fits: boolean | null; deficitKd: number | null }[] };
}

/**
 * The market gate (FLOW step 3) and the session stops. `canOpen` is what the
 * trading routes enforce; `mode` is how the board reads it. Every number is a
 * kb_threshold value the server applied — the browser re-derives none of it.
 */
export interface SessionStops {
  day: string; now: string; clock: string;
  mode: 'trade' | 'careful' | 'cooloff' | 'stop' | 'unknown' | 'pre_open' | 'closed';
  canOpen: boolean; maxTargetTicks: number | null; flatBy: string; pastFlatBy: boolean;
  // SPR-37 · the exchange phase (awsat_market_quotes.session) and the closed flag.
  marketPhase?: string | null; closed?: boolean;
  reasons: string[];
  market: {
    verdict: 'trade' | 'careful' | 'stop' | 'unknown'; reason: string; breadthPct: number | null; clock?: string;
    hourAgo?: { breadthPct: number; clock: string }; dropPts: number | null; rising: boolean | null;
    readings?: Record<string, { breadthPct: number; clock: string } | null>;
  };
  losses: { count: number; contractsClosed: number; stopped: boolean; inCooloff: boolean; cooloffUntil: string | null;
    losses: { symbol: string; seq: number; netKd: number; closedAt: string }[] };
  // R-21 · the 20-minute time stop, per open position (informational — hit the bid).
  timeStops?: { symbol: string; seq: number; minutesHeld: number; entry: number; bid: number | null }[];
  timeStopMins?: number;
  error?: string;
}

export interface SessionInfo {
  // F5 · 'tal' = Trading at Last (13:10–13:30): no new position; an open one may still be closed at the auction price.
  phase: 'pre_open' | 'calm' | 'peak' | 'step_down' | 'tal' | 'closed';
  /** open, or TAL — a position may be closed now. */
  canClose?: boolean;
  hour: number; timeStr: string; driftVsOpen: number; minutesToStepDown: number; lateToOpen: boolean; note: string;
  open: boolean; kuwaitDay: string; reserveReleased: boolean;
  driftByHour: { hour: number; driftFils: number; sessions: number }[]; driftMeasured: boolean;
  // R-11 · the scraper's capture interval; BookTile reads stale (3 × it) from here.
  captureIntervalSecs?: number;
  stops?: SessionStops;
}

export interface MarketDay {
  available: boolean; isToday: boolean; tradingDay?: string; symbolsTraded: number;
  up: number; down: number; flat: number; breadthPct: number; breadth5dAvgPct: number; regime: string | null;
  // R-05 · the band the strip colours by, from the server's regime — the 35/50 thresholds are not in the browser.
  breadthBand?: 'risk_off' | 'neutral' | 'risk_on' | null;
  volumeShares: number; trades: number; turnoverKd: number; volumeVs20d: number; indexYtdPct: number | null;
  computedAt: string | null;
}

/** The socket's `spread:update` payload: the same presenters, all three sections. */
export interface BoardUpdate {
  tradingDay: string; budgetKd: number;
  // CR-8 · the four verdict buckets. The three old names ride along for one release.
  take?: StockCandidate[]; oneAway?: StockCandidate[]; priceWarn?: StockCandidate[]; leave?: StockCandidate[];
  recommended: StockCandidate[]; nearMiss: StockCandidate[]; rejected: StockCandidate[];
  // SPR-38 · cards that fail only on NOT COMPUTED gates — their own bucket.
  notComputed?: StockCandidate[];
  counts: Record<string, number>; reach: { reachable: number; total: number; note: string } | null;
  session: { open: boolean; phase: string; note: string }; coverage: unknown;
  stops?: SessionStops;
  // §0 · null when the board computed; { code, error } when it did not. The
  // buckets are then empty AND meaningless — render BROKEN, never a quiet market.
  error?: { code: string; error: string } | null;
}

// ─── the detail page (GET /api/stocks/:symbol/detail) ──────────────────────
// R-24 · a ladder marker: the machine-readable event and its label from kb_phrase.
export interface LadderMarker { event: string; text: string | null }
export interface BookLevel {
  price: number; qty: number; ordersCount?: number; changed: 'same' | 'thinned' | 'thickened'; prevQty?: number;
  // R-24 · deterministic markers (BAIT/AGED/UNDERCUT/CEILING/SHELF/NOPROT/CATCH), computed server-side.
  markers?: LadderMarker[]; ageMins?: number; aged?: boolean; presencePct?: number;
}
export interface OrderBook {
  symbol: string; bid: number; bid_qty: number; offer: number; offer_qty: number; last_price: number; trades: number;
  bids: BookLevel[]; offers: BookLevel[]; dayRange: { low: number; high: number };
  limitBand: { low: number; high: number }; lastTickTime: string;
}
export interface Sizing {
  symbol: string; price_fils: number | null; floor_kd: number; ceiling_kd: number;
  suggested_kd: number | null; suggested_shares: number | null; your_pct: number | null; net_per_fil_kd: number | null;
  reachable: boolean; reasons: string[];
  // R-23 · the floor is built from the AGED bid; the touch is shown beside it so bait is visible.
  basis: { free_kd: number; committed_kd: number; budget_kd: number; bid_qty: number | null;
    touch_bid_qty?: number | null; aged_bid_qty?: number | null; aged_from_fils?: number | null; aged_age_mins?: number | null;
    bid_note?: string | null; bid_basis?: string; offer_qty: number | null; sized_from: string };
  error?: string; code?: string;
}
/** R-22 · the stop: one fil below the nearest aged shelf, off round numbers, gap-aware. */
export interface Stop {
  symbol: string; stopFils: number | null; shelfFils?: number | null; shelfAgeMins?: number; shelfQty?: number;
  capturedAt?: string | null; steppedForRound?: boolean; gap?: { from: number; to: number; fils: number } | null;
  reason: string; error?: string;
  // F2 · true once a position is open: the stop is the one RECORDED at the fill, never re-derived. hitAt when the bid printed through it.
  fixedAtFill?: boolean; hitAt?: string | null;
}
export interface FillTime {
  symbol: string; bidFils: number; bidShares: number; queueAheadShares: number; queueSharePct: number | null;
  sharesPerMin: number; windowMins: number; estFillMins: number | null; state: string; label: string; error?: string;
}
export interface DepthSignal {
  symbol: string; signal: string; snapshots: number; sampleSufficient: boolean; reason?: string;
  book?: Record<string, number>; error?: string;
}
export interface DetailLeg {
  id: number; seq: number; side: 'BUY' | 'SELL'; status: string; price: number; shares: number;
  filledShares: number | null; commissionKd: number | null; postedAt: string | null; resolvedAt: string | null;
  note: string; exitVenue: string | null;
  // F1 · the queued rest of a partial fill; F2 · the stop fixed at the fill; F3/F4 · taken anyway.
  restStatus?: 'POSTED' | 'FILLED' | 'CANCELLED' | null; restingShares?: number;
  stopFils?: number | null; stopHitAt?: string | null;
  isOverride?: boolean; overrideReason?: string | null;
}
export interface ClosedContract { seq: number; entry: number; exit: number; shares: number; netKd: number; feesKd: number }
/** F6 · one hold fact: computed with its numbers, or not — with the reason. Never a zero. */
export type HoldFact<T extends object = Record<string, unknown>> = ({ computed: true } & T) | { computed: false; reason: string };
export interface HoldFacts {
  mark: HoldFact<{ bidFils: number; entryFils: number | null; unrealisedKd: number | null; markedAt: string | null }>;
  bidProtected: HoldFact<{ qty: number; thresholdQty: number; protectedNow: boolean; agedBelow: boolean; note: string }>;
  exitAt: HoldFact<{ targetNormal: number; targetTrending: number | null; breakEven: number | null; stopFils: number | null }>;
  volume: HoldFact<{ ratio: number; note: string }>;
  ceiling: HoldFact<{ priceFils: number | null; qty: number | null; presencePct: number | null; note: string }>;
  refill: HoldFact;
  exitOk: HoldFact<{ offerQty: number; yourShares: number; multiple: number; thresholdX: number; ok: boolean; note: string }>;
}

export interface Detail {
  symbol: string; tradingDay: string; budgetKd: number;
  candidate: StockCandidate | null; orderBook: OrderBook | null;
  // F6 · the hold block, assembled server-side from this same bundle.
  holdFacts?: HoldFacts;
  sizing: Sizing; fillTime: FillTime | null; depthSignal: DepthSignal;
  contract: TradingContract | null; legs: DetailLeg[]; closedToday: ClosedContract[];
  stop?: Stop;
  // R-06 · the server's lot-rounded suggested size; the ladder's "% yours" is computed from THIS.
  yourShares?: number | null;
  // R-26 · the last price move and whether a print under paint_max_shares carried it.
  lastMove?: { priceFils: number; qty: number | null; painted: boolean; at: string; paintMaxShares: number } | null;
  // R-11 · the scraper's capture interval (from QUALITY); the ladder's stale = 3 × it.
  captureIntervalSecs?: number;
  // F5 · canClose: open, or Trading at Last (close at the auction price only).
  session: { open: boolean; phase: string; note: string; canClose?: boolean; tal?: boolean };
}

/** What the trading writes answer. */
export interface TradeResult {
  ok?: boolean; warning?: string | null; commissionKnown?: boolean; costKd?: number; note?: string;
  ruleBreach?: { mode: string; reasons: string[]; at: string } | null;
  // F1 · a partial fill: what filled and what is still resting on the leg.
  partial?: { filled: number; of: number; resting: number } | null;
  rest?: { of: number; filled: number; resting?: number; cancelled?: number };
  // F2 · the stop recorded at the fill (null with the reason when no shelf had aged).
  stop?: { stopFils: number | null; reason: string } | null;
  // F5 · where the close happened.
  venue?: 'MARKET' | 'AUCTION';
  contracts: TradingContract[];
}
/** F3 / F4 · the 409 codes the operator may take anyway (with a reason). Plain REFUSED is not one of them. */
export const OVERRIDABLE_CODES = ['OUTSIDE_SIZE_BAND', 'NOT_TAKE', 'BOARD_NOT_COMPUTED'] as const;
export type OverridableCode = typeof OVERRIDABLE_CODES[number];

/** Alerts the socket pushes into the feed. */
export interface AlertMsg { kind: string; symbol?: string; level: 'danger' | 'warning' | 'info'; title: string; body: string; at: string }
export interface EntryAlertMsg { symbol: string; fire: boolean; bidFils: number; offerFils: number; spreadFils: number; offerShares: number; myShares: number; estFillMins: number | null; depthSignal: string | null; reason: string; alertId?: number; audible?: boolean; suppressed?: boolean; suppressedReason?: string | null }

// ─── SPR-07/08 · the feed replays from the server (GET /api/feed) ───────────
export interface FeedServerEvent { id: string; kind: 'entry' | 'halt'; symbol: string; at: string; level: string; title: string; body: string }

// ─── SPR-27/30 · the capture-feed roster (GET /api/feeds, spread:feedHealth) ─
// `degraded` (backend feedHealth / scraper 040): checking in, but the panel
// reports a problem, sees 0 rows in the session, or nothing has been accepted.
export interface FeedScript {
  script: string; status: 'ok' | 'silent' | 'absent' | 'degraded'; reason?: string | null;
  version?: string | null; rowsSeen?: number | null; rowsInserted?: number | null; problem?: string | null;
  lastSeenAt?: string | null; silentSec?: number | null; lastSubmissionAt?: string | null; submissionSec?: number | null;
}
export interface FeedHealth { available: boolean; maxAgeSec?: number; scripts: FeedScript[] }
export interface StrandedMsg { symbol: string; legId: number; message: string; options?: string[]; side?: 'BUY' | 'SELL'; code?: string; priceFils?: number; bidFils?: number; offerFils?: number | null; quoteAt?: string | null }

/** GET /api/health — open without a token; 503 when `status` is 'stale'. */
export interface Health {
  status: 'ok' | 'stale' | 'down'; time: string; quoteAgeSec: number | null; latestQuoteAt: string | null;
  latestStatsDay: string | null; session: { open: boolean; phase: string | null }; staleAfterSec: number; note: string | null;
}
/** GET /api/gates — one row per gate, as the config panel shows it. */
export interface GateConfig {
  id: string; group: string; gateName: string; currentValue: string; numericValue: number | null; unit: string;
  ruleDescription: string; evidence: string; observationCount: number; confidence: string; lastChanged: string;
  configVersion: number; locked: boolean; isToggle: boolean; rejectsCount: number;
}
/** GET /api/orders — contracts with their legs and the behaviour flags. */
export interface OrdersFeed {
  contracts: {
    key: string; symbol: string; contractDay: string; seq: number; state: string;
    grossKd: number | null; commissionKd: number; netKd: number | null; fills: number; executions: number;
    heldMinutes: number | null; flags: { flag: string; [k: string]: unknown }[]; legs: unknown[];
  }[];
  summary: { ordersPlaced: number; fills: number; fillRatePct: number | null; exitsAsPosted: number; exitsMovedDown: number; contractsClosed: number };
}
/** GET /api/performance/daily */
export interface PerformanceDaily {
  days: { day: string; [k: string]: unknown }[];
  summary: { sessions: number; fills: number; trips: number; netKd: number; commissionKd: number; commissionPctOfLoss: number | null; winners: number; losers: number };
}
/** GET /api/ledger — one cash movement with the running balance. */
export interface LedgerEntry { id: number; at: string; kind: string; amount_kd: number; balance_kd: number; note: string | null; symbol?: string | null }
/** GET /api/ai/history */
export interface AiHistoryItem { id: string; timestamp: string; text: string }
/** GET /api/candles/:symbol */
export interface Candles { symbol: string; intervalMinutes: number; grain: 'intraday' | 'day' | 'week'; candles: { time: string; open: number; high: number; low: number; close: number; volume: number }[] }
export interface WakeupMsg { day: string; at: string; flagged: { symbol: string; [k: string]: unknown }[]; lowConfidence: boolean }
// FLOW 6.7 · the halt-resume detector. A HALT is informational; a RESUME carries
// the verdict already computed — the window is ~2 minutes.
export interface HaltMsg {
  phase: 'HALT' | 'RESUME'; symbol: string; direction: 'DOWN' | 'UP' | null; at: string;
  // HALT
  haltPrice?: number | null; slotRequest?: { swapIn: string; displace: number | null; displaceSymbol?: string; reason: string; stale?: boolean } | null;
  // G-1 · the swap was applied (or refused) by the backend; the HALT carries the outcome.
  slotOutcome?: { applied: boolean; slot: number | null; replaced: string | null; reason: string | null } | null;
  // RESUME — A3: verdict now includes 'SECOND HALT — CASCADE' and 'SELLERS STILL QUEUED'.
  verdict?: string; verdictDetail?: string; resumePrice?: number; resumePriceFils?: number; yourShares?: number; yourPctBid?: number | null;
  exitMultiple?: number | null; offerOverBid?: number | null; halved?: boolean;
  touchBidQty?: number; touchOfferQty?: number;
  // A3 · ceil(prev_close × 0.95) — a reference the UI shows, NEVER labelled a floor.
  bandRefFils?: number | null;
  targetFils?: number; stopFils?: number; tradeable?: boolean; audible?: boolean;
  // G-3 · symbolHistory now comes from the ONE scoring home (signal_log): reached5Fils / avgFils.
  history?: { halts: number; gave5?: number; avgGain?: number | null; reached5Fils?: number; avgFils?: number | null };
  symbolHistory?: { halts: number; gave5?: number; avgGain?: number | null; reached5Fils?: number; avgFils?: number | null };
}

// A4 · a depth slot whose capture has gone stale (>10 min) during the session.
export interface SlotStaleMsg {
  slot: number; symbol: string; lastCaptureAt: string | null;
}
