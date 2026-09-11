// @vitest-environment jsdom
/**
 * CR-8 · four buckets, nothing removed — on the TODAY board.
 *   TAKE / ONE AWAY / PRICE WARN / LEAVE + NOT COMPUTED, every symbol in one;
 *   PRICE WARN prints the fils it needs at this budget;
 *   the ABAR row (no symbol_day row) is IN NOT COMPUTED with its last-row line;
 *   structural rows are FOLDED at the foot of LEAVE with counts — openable,
 *   never filtered.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import stocks from "./fixtures/stocks.json";
import type { StockCandidate, MarketDay, Budget, TradingContract } from "../src/api/types";
import type { Board, Live } from "../src/api/hooks";
import { TodayView } from "../src/components/TodayView";

const base = (stocks as { body: StockCandidate[] }).body[0];
const cand = (o: Partial<StockCandidate>): StockCandidate => ({ ...base, notComputed: [], failingGateNames: [], structuralReason: null, noRow: false, lastRowDay: null, behaviourFlags: [], ...o } as StockCandidate);

const board = (): Board => {
  const take = [cand({ symbol: "KHOT", bucket: "TAKE", status: "recommended", takeItBecause: "passes every gate" })];
  const oneAway = [cand({ symbol: "MRC", bucket: "ONE_AWAY", status: "near_miss", failingGateNames: ["movement"] })];
  const priceWarn = [cand({ symbol: "SHUAIBA", bucket: "PRICE_WARN", status: "price_warn", price: 284, needsFils: 3, failingGateNames: ["price band", "profit floor"] })];
  const leave = [
    cand({ symbol: "CATTL", bucket: "LEAVE", status: "rejected", failingGateNames: ["movement", "tape quality"] }),
    cand({ symbol: "REACH", bucket: "LEAVE", status: "rejected", structuralReason: "OUT_OF_REACH", isOutOfReach: true, failingGateNames: [], rejectionDetail: "out of reach at 700 KD — needs 2500 KD" }),
    cand({ symbol: "TINY", bucket: "LEAVE", status: "rejected", structuralReason: "BELOW_TICK", isStructuralFailure: true, failingGateNames: ["price band"], price: 80 }),
    cand({ symbol: "SUSP", bucket: "LEAVE", status: "rejected", structuralReason: "SUSPENDED", failingGateNames: [], rejectionDetail: "suspended — broker status DELISTED" }),
  ];
  const notComputed = [cand({ symbol: "ABAR", bucket: "NOT_COMPUTED", status: "not_computed", noRow: true, lastRowDay: "2026-07-25", dataQuality: "MISSING", notComputed: ["price band", "movement"], failingGateNames: ["price band", "movement"], rejectionDetail: "no symbol_day row for 2026-09-10 — last row 2026-07-25" })];
  return { take, oneAway, priceWarn, leave, notComputed, recommended: take, nearMiss: oneAway, rejected: [...priceWarn, ...leave],
    all: [...take, ...oneAway, ...priceWarn, ...leave, ...notComputed],
    counts: { universe: 8, take: 1, oneAway: 1, priceWarn: 1, leave: 4, notComputed: 1, outOfReach: 1, belowTick: 1, suspended: 1, noRow: 1, movement: 2 },
    tradingDay: "2026-09-10", budgetKd: 700, reach: null, stops: null };
};
const live = <T,>(data: T | null): Live<T> => ({ data, error: null, loading: false, at: Date.now(), refresh: () => {} }) as Live<T>;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (b: Board) => act(() => root.render(
  <TodayView board={b} boardError={null} boardLoading={false} connected boardAt={Date.now()}
    market={live<MarketDay>(null)} budget={live<Budget>(null)} contracts={live<TradingContract[]>([])} onPickSymbol={() => {}} />));

describe("TODAY · CR-8", () => {
  it("every symbol is on the board, in its section — the state line counts the five buckets", () => {
    render(board());
    const t = host.textContent || "";
    expect(t).toMatch(/8 symbols · 1 take · 1 one away · 1 price warn · 4 leave · 1 not computed/);
    for (const s of ["KHOT", "MRC", "SHUAIBA", "CATTL", "ABAR"]) expect(host.querySelector(`#plan-card-${s}`)).not.toBeNull();
    expect(host.querySelector("#section-one-away")).not.toBeNull();
    expect(host.querySelector("#section-price-warn")).not.toBeNull();
    expect(host.querySelector("#section-leave")).not.toBeNull();
  });

  it("PRICE WARN says the fils it needs at this budget — an economics line, not a verdict", () => {
    render(board());
    const c = host.querySelector("#plan-card-SHUAIBA")!;
    expect(c.getAttribute("data-bucket")).toBe("PRICE_WARN");
    expect(c.textContent).toMatch(/price 284 — needs 3 fils at 700 KD/);
  });

  it("the ABAR row is IN NOT COMPUTED with 'no symbol_day row … — last row 2026-07-25' — never absent", () => {
    render(board());
    const c = host.querySelector("#plan-card-ABAR")!;
    expect(c).not.toBeNull();
    expect(c.getAttribute("data-bucket")).toBe("NOT_COMPUTED");
    expect(c.textContent).toMatch(/no symbol_day row for 2026-09-10 — last row 2026-07-25/);
    expect(host.textContent).toMatch(/NOT COMPUTED · 1 · 1 with no row for this day/);
  });

  it("structural LEAVE rows are FOLDED with counts, and the fold opens — folded, never filtered", () => {
    render(board());
    // open rows render; structural ones are behind the fold
    expect(host.querySelector("#plan-card-CATTL")).not.toBeNull();
    expect(host.querySelector("#plan-card-REACH")).toBeNull();
    const fold = host.querySelector("#leave-fold")!;
    expect(fold.textContent).toMatch(/3 folded — 1 out of reach at 700 KD · 1 below the 100-fil tick · 1 suspended · arithmetic, not judgement: no override/);
    act(() => { (fold as HTMLButtonElement).click(); });
    for (const s of ["REACH", "TINY", "SUSP"]) {
      const c = host.querySelector(`#plan-card-${s}`)!;
      expect(c).not.toBeNull();
      expect(c.getAttribute("data-structural")).toBeTruthy();
    }
    expect(host.querySelector("#plan-card-REACH")!.textContent).toMatch(/out of reach at 700 KD — needs 2500 KD/);
  });
});
