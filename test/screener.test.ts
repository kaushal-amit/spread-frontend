/**
 * C1/C2 · the screener filters and columns are pure predicates over fields the
 * candidate payload already carries — no DOM, no threshold re-derivation.
 */
import { describe, it, expect } from "vitest";
import { applyScreener, screenerDef, screenerLabel, screenerColumns, SCREENER_FILTERS } from "../src/lib/screener";
import type { StockCandidate } from "../src/api/types";

// A minimal candidate; each test overrides only the fields its predicate reads.
function cand(over: Partial<StockCandidate> = {}): StockCandidate {
  const base: StockCandidate = {
    symbol: "X", price: 168, bid: 167, offer: 169, spread: 2,
    entryPlacement: "AT_BID", shares: 4000, notionalKd: 672, roundTripKd: 3.4, netKd: 0.8, netPerFilKd: 4,
    trendWarn: false, changeFils: 2, changePct: 1.2, rising: true,
    status: "recommended", verdict: "TRADABLE",
    failingGatesCount: 0, failingGateNames: [],
    gateGroups: [{ groupName: "Does it move", cells: [
      { label: "Tape quality", ok: true, warn: false, value: "10%", sub: "" },
    ] }],
    headroom: { minKd: 400, maxKd: 1600, profitPerFil: 4, currentKd: 800, headroomX: 2 },
    market: "MAIN", marketVerified: true, isDead: false, isOutOfReach: false, isStructuralFailure: false,
    behaviourFlags: [],
    metrics: {
      priceFils: 168, netKd: 0.8, netPerFilKd: 4, tradeSizeShares: 1500, movesPerDay: 12,
      moves2PlusPerDay: 6, tapeQualityPct: 10, tapeQualityUpPct: 12, postablePct: 30, exitDepthPct: 40,
      volSpikeRatio: 1.1, outwardBlockFlowRatio: 0.9, consistencyDays: 5, gapPresentPct: 40,
      dailyRangeFils: 8, targetTicks: 1, walkedUp: false,
    },
    dataQuality: "OK", notComputed: [], gateStatsSource: "SCRAPER", everTraded: true, bookCapturedToday: true,
  } as StockCandidate;
  return { ...base, ...over, metrics: { ...base.metrics, ...(over.metrics || {}) } };
}

describe("screener · the seven filters (C1)", () => {
  it("ALL passes everything and is the default", () => {
    const list = [cand(), cand({ status: "rejected", isOutOfReach: true })];
    expect(applyScreener(list, "ALL")).toHaveLength(2);
    expect(screenerDef("ALL").key).toBe("ALL");
  });

  it("PASSES EVERY GATE keeps only the recommended", () => {
    const list = [cand({ status: "recommended" }), cand({ status: "near_miss" }), cand({ status: "rejected" })];
    expect(applyScreener(list, "PASSES").map((s) => s.status)).toEqual(["recommended"]);
  });

  it("REACHABLE drops out-of-reach and folds the slot into the label", () => {
    const list = [cand({ isOutOfReach: false }), cand({ isOutOfReach: true })];
    expect(applyScreener(list, "REACHABLE")).toHaveLength(1);
    expect(screenerLabel(screenerDef("REACHABLE"), 800)).toBe("REACHABLE AT 800 KD");
    expect(screenerLabel(screenerDef("REACHABLE"), null)).toBe("REACHABLE AT — KD");
  });

  it("RISING 1d+5d needs rising AND no down-trend warn", () => {
    expect(applyScreener([cand({ rising: true, trendWarn: false })], "RISING")).toHaveLength(1);
    expect(applyScreener([cand({ rising: true, trendWarn: true })], "RISING")).toHaveLength(0);
    expect(applyScreener([cand({ rising: false, trendWarn: false })], "RISING")).toHaveLength(0);
  });

  it("CLEAN TAPE needs Gate 5 ok and not walked-up", () => {
    const clean = cand();
    const walked = cand({ metrics: { walkedUp: true } as StockCandidate["metrics"] });
    const dirty = cand({ gateGroups: [{ groupName: "Does it move", cells: [
      { label: "Tape quality", ok: false, warn: false, value: "55%", sub: "" }] }] });
    expect(applyScreener([clean], "CLEAN_TAPE")).toHaveLength(1);
    expect(applyScreener([walked], "CLEAN_TAPE")).toHaveLength(0);
    expect(applyScreener([dirty], "CLEAN_TAPE")).toHaveLength(0);
  });

  it("BOOK CAPTURED is the server's bookCapturedToday, not dataQuality", () => {
    expect(applyScreener([cand({ bookCapturedToday: true, dataQuality: "NO_BOOK" })], "BOOK")).toHaveLength(1);
    expect(applyScreener([cand({ bookCapturedToday: false, dataQuality: "OK" })], "BOOK")).toHaveLength(0);
    expect(applyScreener([cand({ bookCapturedToday: null })], "BOOK")).toHaveLength(0);
  });

  it("NEVER TRADED is the server's everTraded === false (no order_leg row ever), not consistencyDays", () => {
    expect(applyScreener([cand({ everTraded: false, metrics: { consistencyDays: 3 } as StockCandidate["metrics"] })], "NEVER_TRADED")).toHaveLength(1);
    expect(applyScreener([cand({ everTraded: true, metrics: { consistencyDays: 0 } as StockCandidate["metrics"] })], "NEVER_TRADED")).toHaveLength(0);
    expect(applyScreener([cand({ everTraded: null })], "NEVER_TRADED")).toHaveLength(0);
  });

  it("there are exactly seven filters, ALL first", () => {
    expect(SCREENER_FILTERS).toHaveLength(7);
    expect(SCREENER_FILTERS[0].key).toBe("ALL");
  });
});

describe("screener · the columns (C2)", () => {
  it("builds the reference columns from metrics/headroom", () => {
    const cols = screenerColumns(cand());
    const by = Object.fromEntries(cols.map((c) => [c.k, c.v]));
    expect(by.px).toBe("168");
    expect(by.tick).toBe("1t");
    expect(by["1d"]).toBe("+2");
    expect(by.tiny).toBe("10%");
    expect(by.mv).toBe("12");
    expect(by.up2).toBe("6");
    expect(by.exit).toBe("40%");
    expect(by["gross/fil"]).toBe("4.000");
    expect(by.reach).toBe("2×");
  });

  it("an uncomputed statistic prints '—', never a zero (0 is a measurement)", () => {
    const c = cand();
    const nc = {
      ...c, price: null, changeFils: null, headroom: { ...c.headroom, headroomX: null },
      metrics: { ...c.metrics, tapeQualityPct: null, movesPerDay: null, moves2PlusPerDay: null,
        volSpikeRatio: null, postablePct: null, exitDepthPct: null, netPerFilKd: null, consistencyDays: null },
    } as unknown as StockCandidate;
    const by = Object.fromEntries(screenerColumns(nc).map((x) => [x.k, x.v]));
    for (const k of ["px", "1d", "tiny", "mv", "up2", "vol", "post", "exit", "gross/fil", "reach"]) expect(by[k]).toBe("—");
    // a MEASURED zero still prints 0
    const zero = { ...c, changeFils: 0, metrics: { ...c.metrics, movesPerDay: 0 } } as StockCandidate;
    const bz = Object.fromEntries(screenerColumns(zero).map((x) => [x.k, x.v]));
    expect(bz.mv).toBe("0");
    expect(bz["1d"]).toBe("+0");
    // and the 1d change is whole fils (SPR-39)
    expect(Object.fromEntries(screenerColumns({ ...c, changeFils: 0.8999999 } as StockCandidate).map((x) => [x.k, x.v]))["1d"]).toBe("+1");
  });

  it("NEVER TRADED matches a measured false, not an unmeasured null", () => {
    const c = cand();
    const nt = screenerDef("NEVER_TRADED").predicate;
    expect(nt({ ...c, everTraded: false })).toBe(true);
    expect(nt({ ...c, everTraded: null })).toBe(false);
  });
});
