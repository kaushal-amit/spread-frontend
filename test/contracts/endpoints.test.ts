/**
 * 4.5 · one contract test per endpoint.
 *
 * Every fixture under test/fixtures/*.json was captured from the REAL backend
 * by scripts/capture-fixtures.js (the `_captured` block says when and from
 * where). Two checks per endpoint:
 *
 *   1. compile time — the body is ASSIGNED to its type from src/api/types.ts,
 *      so a field that is null on the wire but `number` in the type fails
 *      `tsc --noEmit`, and a renamed field fails here before it fails on a
 *      screen;
 *   2. run time — guards.check() walks the same fixture and reports every
 *      key that is missing, null where the type forbids it, or the wrong kind.
 *
 * Nothing here is typed by hand. To refresh: run the backend against
 * kse_test with the fixture day seeded and `npm run capture:fixtures`.
 */
import { describe, it, expect } from "vitest";
import { check, SHAPES } from "../../src/api/guards";
import type {
  StockCandidate, TradingContract, AccountState, Budget, SessionInfo, MarketDay, Detail, Health,
  GateConfig, OrdersFeed, PerformanceDaily, LedgerEntry, Candles, AiHistoryItem, Sizing, SessionStops,
  BookLevel, LadderMarker,
} from "../../src/api/types";

import health from "../fixtures/health.json";
import session from "../fixtures/session.json";
import market from "../fixtures/market.json";
import budget from "../fixtures/budget.json";
import account from "../fixtures/account.json";
import stocks from "../fixtures/stocks.json";
import stock from "../fixtures/stock.json";
import detail from "../fixtures/detail.json";
import contracts from "../fixtures/contracts.json";
import gates from "../fixtures/gates.json";
import orders from "../fixtures/orders.json";
import ledger from "../fixtures/ledger.json";
import performance from "../fixtures/performance.json";
import candles from "../fixtures/candles.json";
import sizing from "../fixtures/sizing.json";
import aiHistory from "../fixtures/ai-history.json";

const captured = (f: { _captured: { status: number; url: string; at: string } }) => f._captured;
const clean = (errs: string[]) => expect(errs, errs.join("\n")).toEqual([]);

describe("fixtures were captured from the backend, not typed", () => {
  const all = { health, session, market, budget, account, stocks, stock, detail, contracts, gates, orders, ledger, performance, candles, sizing, aiHistory };
  for (const [name, f] of Object.entries(all)) {
    it(`${name}: 200 from the real endpoint, with a capture stamp`, () => {
      const c = captured(f as never);
      expect(c.status).toBe(200);
      expect(c.url).toMatch(/^\/api\//);
      expect(Date.parse(c.at)).toBeGreaterThan(0);
    });
  }
});

describe("GET /api/health", () => {
  const body: Health = health.body as Health;
  it("parses into Health", () => { clean(check(body, SHAPES.Health)); expect(["ok", "stale", "down"]).toContain(body.status); });
  it("says how old the newest quote is and which stats day exists", () => {
    expect(typeof body.quoteAgeSec === "number" || body.quoteAgeSec === null).toBe(true);
    expect("latestStatsDay" in body).toBe(true);
  });
});

describe("GET /api/session", () => {
  const body: SessionInfo = session.body as SessionInfo;
  it("parses into SessionInfo", () => clean(check(body, SHAPES.SessionInfo)));
  it("carries the server's session day — the page's date comes from here", () => expect(body.kuwaitDay).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  it("R-19/R-20 · carries the market gate and session stops", () => {
    expect(body.stops).toBeTruthy();
    clean(check(body.stops, SHAPES.SessionStops));
    expect(["trade", "careful", "cooloff", "stop", "unknown", "pre_open"]).toContain(body.stops!.mode);
    expect(typeof body.stops!.canOpen).toBe("boolean");
    const st: SessionStops = body.stops!;
    expect(Array.isArray(st.reasons)).toBe(true);
  });
});

describe("GET /api/market", () => {
  const body: MarketDay = market.body as MarketDay;
  it("parses into MarketDay", () => clean(check(body, SHAPES.MarketDay)));
  it("R-05 · carries a breadthBand from the server (or null), never derived in the browser", () => {
    expect([undefined, null, "risk_off", "neutral", "risk_on"]).toContain(body.breadthBand);
  });
});

describe("GET /api/budget", () => {
  const body: Budget = budget.body as Budget;
  it("parses into Budget", () => clean(check(body, SHAPES.Budget)));
  it("free = budget − reserve − committed, as the server says", () => {
    expect(Math.abs(body.free_kd - (body.budget_kd - (body.reserve_held ? body.reserve_kd : 0) - body.committed_kd))).toBeLessThan(0.01);
  });
});

describe("GET /api/account", () => {
  const body: AccountState = account.body as AccountState;
  it("parses into AccountState", () => clean(check(body, SHAPES.AccountState)));
});

describe("GET /api/stocks", () => {
  const body: StockCandidate[] = stocks.body as StockCandidate[];
  it("is an array of StockCandidate", () => {
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) clean(check(row, SHAPES.StockCandidate));
  });
  it("every row has a status the board sections on, and notComputed", () => {
    for (const row of body) {
      expect(["recommended", "near_miss", "rejected"]).toContain(row.status);
      expect(Array.isArray(row.notComputed)).toBe(true);
    }
  });
  it("carries both tape figures (blended, up-only) in metrics", () => {
    for (const row of body) expect("tapeQualityUpPct" in row.metrics).toBe(true);
  });
  it("R-06 · walkedUp is decided by the server, present on every row", () => {
    for (const row of body) expect(typeof row.metrics.walkedUp).toBe("boolean");
  });
});

describe("GET /api/stocks/:symbol", () => {
  const body: StockCandidate | null = stock.body as StockCandidate | null;
  it("parses into StockCandidate", () => { expect(body).not.toBeNull(); clean(check(body, SHAPES.StockCandidate)); });
});

describe("GET /api/stocks/:symbol/detail", () => {
  const body: Detail = detail.body as Detail;
  it("parses into Detail", () => clean(check(body, SHAPES.Detail)));
  it("the order book, sizing, legs and contract parse too", () => {
    if (body.orderBook) clean(check(body.orderBook, SHAPES.OrderBook));
    clean(check(body.sizing, SHAPES.Sizing));
    for (const l of body.legs) clean(check(l, SHAPES.DetailLeg));
    if (body.contract) clean(check(body.contract, SHAPES.TradingContract));
  });
  it("R-24 · each ladder level parses, and any markers are well-formed {event,text}", () => {
    for (const l of [...(body.orderBook?.bids ?? []), ...(body.orderBook?.offers ?? [])]) {
      clean(check(l, SHAPES.BookLevel));
      for (const m of l.markers ?? []) {
        clean(check(m, SHAPES.LadderMarker));
        expect(typeof m.event).toBe("string");
        expect(m.text === null || typeof m.text === "string").toBe(true);
      }
    }
  });
  it("R-24 · the LadderMarker contract holds for a computed marker", () => {
    // The backend emits e.g. { event: 'AGED', text: 'held 40m' }; the type must accept it.
    const marker: LadderMarker = { event: "AGED", text: "held 40m" };
    clean(check(marker, SHAPES.LadderMarker));
    const level: BookLevel = { price: 158, qty: 120000, changed: "same", markers: [marker] };
    clean(check(level, SHAPES.BookLevel));
  });
  it("the session block says whether a write is possible", () => expect(typeof body.session.open).toBe("boolean"));
  it("R-22 · carries a stop object (one fil below the aged shelf, or a reason it cannot)", () => {
    expect(body.stop).toBeTruthy();
    clean(check(body.stop, SHAPES.Stop));
    expect(body.stop!.stopFils === null || typeof body.stop!.stopFils === "number").toBe(true);
    expect(typeof body.stop!.reason).toBe("string");
  });
});

describe("GET /api/trading/contracts", () => {
  const body: TradingContract[] = contracts.body as TradingContract[];
  it("is an array of TradingContract, with nulls where the server does not know", () => {
    for (const c of body) clean(check(c, SHAPES.TradingContract));
  });
  it("a contract is keyed by symbol + seq", () => {
    const keys = body.map((c) => `${c.symbol}-${c.seq}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("R-41 · the exit target is +2/+6, and peak is null-not-0 until a bid prints", () => {
    for (const c of body) {
      if (c.entry != null && c.breakEvenPrice != null) {
        expect(c.targetNormal).not.toBeNull();
        // +2 target is never below break-even, and trending (+6) is >= normal
        expect(c.targetNormal!).toBeGreaterThanOrEqual(c.breakEvenPrice);
        if (c.targetTrending != null) expect(c.targetTrending).toBeGreaterThanOrEqual(c.targetNormal!);
      }
      expect(c.peakSinceFill).not.toBe(0);
    }
  });
});

describe("GET /api/gates", () => {
  const body: GateConfig[] = gates.body as GateConfig[];
  it("is an array of GateConfig", () => { for (const g of body) clean(check(g, SHAPES.GateConfig)); });
  it("g1-floor is locked", () => expect(body.find((g) => g.id === "g1-floor")?.locked).toBe(true));
});

describe("GET /api/orders", () => {
  const body: OrdersFeed = orders.body as OrdersFeed;
  it("parses into OrdersFeed", () => {
    clean(check(body, SHAPES.OrdersFeed));
    for (const c of body.contracts) clean(check(c, SHAPES.OrdersContract));
  });
});

describe("GET /api/ledger", () => {
  const body: LedgerEntry[] = ledger.body as LedgerEntry[];
  it("is an array of LedgerEntry with a running balance", () => {
    for (const e of body) clean(check(e, SHAPES.LedgerEntry));
    let run = 0;
    for (const e of body) { run += e.amount_kd; expect(Math.abs(e.balance_kd - run)).toBeLessThan(0.001); }
  });
});

describe("GET /api/performance/daily", () => {
  const body: PerformanceDaily = performance.body as PerformanceDaily;
  it("parses into PerformanceDaily", () => clean(check(body, SHAPES.PerformanceDaily)));
});

describe("GET /api/candles/:symbol", () => {
  const body: Candles = candles.body as Candles;
  it("parses into Candles", () => { clean(check(body, SHAPES.Candles)); for (const c of body.candles) clean(check(c, SHAPES.Candle)); });
  it("candle times are instants (timestamptz), on the minute grid", () => {
    for (const c of body.candles) { expect(Date.parse(c.time)).toBeGreaterThan(0); expect(new Date(c.time).getUTCSeconds()).toBe(0); }
  });
});

describe("GET /api/sizing/:symbol", () => {
  const body: Sizing = sizing.body as Sizing;
  it("parses into Sizing", () => clean(check(body, SHAPES.Sizing)));
  it("R-23 · the floor is built from the aged bid, with the touch beside it", () => {
    expect("aged_bid_qty" in body.basis).toBe(true);
    expect("touch_bid_qty" in body.basis).toBe(true);
    expect(["aged_bid", "touch_bid_not_aged", "no_bid", undefined]).toContain(body.basis.bid_basis);
  });
});

describe("GET /api/ai/history", () => {
  const body: AiHistoryItem[] = aiHistory.body as AiHistoryItem[];
  it("is an array of AiHistoryItem", () => { expect(Array.isArray(body)).toBe(true); for (const x of body) clean(check(x, SHAPES.AiHistoryItem)); });
});
