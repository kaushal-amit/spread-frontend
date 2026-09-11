// @vitest-environment jsdom
/**
 * board-polish:
 *   F11  the wake-up pace from the server's scan shows on the TODAY card and on
 *        the live chip (a wake chip, or the badge on an existing chip)
 *   F14  the ADD panel filters with the SAME seven screener chips as TODAY, and
 *        sorts TAKE first then by known net
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import type { StockCandidate, TradingContract } from "../src/api/types";

vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, apiGet: vi.fn(() => new Promise(() => {})), apiPost: vi.fn(async () => ({ ok: true })) };
});
vi.mock("socket.io-client", () => ({ io: () => ({ connected: true, on: () => {}, off: () => {}, emit: () => {} }) }));

import { TodayView } from "../src/components/TodayView";
import { TabBar, type LiveChip } from "../src/components/TabBar";
import { SymbolSearch } from "../src/components/SymbolSearch";
import { SCREENER_FILTERS } from "../src/lib/screener";

const card = (symbol: string, over: Partial<StockCandidate> = {}): StockCandidate => ({
  symbol, price: 200, bid: 199, offer: 201, spread: 2, entryPlacement: "AT_BID", shares: 1000, notionalKd: 200, roundTripKd: 1, netKd: 1, netPerFilKd: 1,
  trendWarn: false, changeFils: 0, changePct: 0, rising: true, status: "recommended", verdict: "TRADABLE", bucket: "TAKE", structuralReason: null, noRow: false, lastRowDay: null,
  failingGatesCount: 0, failingGateNames: [], gateGroups: [{ groupName: "g", cells: [{ label: "Tape quality", ok: true, warn: false, value: "5%", sub: "" }] }],
  headroom: { minKd: 300, maxKd: 900, profitPerFil: 1, currentKd: 700, headroomX: 1 }, market: "Main Market", marketVerified: true,
  isDead: false, isOutOfReach: false, isStructuralFailure: false, behaviourFlags: [],
  metrics: { priceFils: 200, netKd: 1, netPerFilKd: 1, tradeSizeShares: 100, movesPerDay: 20, moves2PlusPerDay: 5, tapeQualityPct: 5, tapeQualityUpPct: 5, postablePct: 50, exitDepthPct: 50, volSpikeRatio: 1, outwardBlockFlowRatio: 1, consistencyDays: 5, gapPresentPct: 0, dailyRangeFils: 5, targetTicks: 2 },
  dataQuality: "OK", everTraded: false, bookCapturedToday: true, notComputed: [], gateStatsSource: "SCRAPER", wakeup: null, ...over,
} as StockCandidate);
const live = <T,>(data: T | null) => ({ data, loading: false, error: null, at: Date.now(), refresh: () => {} }) as never;
const board = (cards: StockCandidate[]) => ({ tradingDay: "2026-09-10", budgetKd: 700, take: cards.filter((c) => c.bucket === "TAKE"), oneAway: cards.filter((c) => c.bucket === "ONE_AWAY"), priceWarn: [], leave: cards.filter((c) => c.bucket === "LEAVE"), notComputed: [], all: cards, counts: { all: cards.length }, stops: null, recommended: cards.filter((c) => c.bucket === "TAKE"), nearMiss: [], rejected: [], reach: null }) as never;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("F11 · the wake-up pace", () => {
  it("shows on the TODAY card with the reason on hover, and a ? when the reading is early", async () => {
    const cards = [card("KHOT", { wakeup: { paceRatio: 12, tradesSoFar: 120, baseline: 10, measuredAt: "10:00", lowConfidence: false, why: "120 trades against a normal 10 by this hour — 12× its own pace" } }),
      card("ABAR", { wakeup: { paceRatio: 4, tradesSoFar: 8, baseline: 2, measuredAt: "09:00", lowConfidence: true, why: "8 trades against a normal 2" } }), card("MRC")];
    await act(async () => { root.render(<TodayView board={board(cards)} boardError={null} boardLoading={false} connected boardAt={Date.now()} market={live(null)} budget={live(null)} contracts={live([] as TradingContract[])} onPickSymbol={() => {}} />); });
    const badge = (sym: string) => host.querySelector(`#plan-card-${sym} .wake-badge`);
    expect(badge("KHOT")?.textContent).toBe(" 12×");
    expect(badge("KHOT")?.getAttribute("title")).toMatch(/12× its own pace/);
    expect(badge("ABAR")?.textContent).toBe(" 4×?");
    expect(badge("ABAR")?.getAttribute("title")).toMatch(/low confidence this early/);
    expect(badge("MRC")).toBeNull();
  });
  it("a wake chip carries the pace; a symbol already on a chip keeps its chip with the badge", async () => {
    const chips: LiveChip[] = [{ symbol: "MRC", price: 204, kind: "go", paceRatio: 3, lowConfidence: false }, { symbol: "KHOT", price: 150, kind: "wake", paceRatio: 12, lowConfidence: false }];
    await act(async () => { root.render(<TabBar liveChips={chips} onPickSymbol={() => {}} cur={-1} curSymbol={null} alert={{ on: false, kind: "", sym: "", key: "", txt: "" }} onPick={() => {}} onClose={() => {}} onPopGo={() => {}} />); });
    const khot = host.querySelector("#chip-KHOT")!;
    expect(khot.className).toMatch(/\bwake\b/);
    expect(khot.getAttribute("data-kind")).toBe("wake");
    expect(khot.querySelector(".wake-badge")?.textContent).toBe(" 12×");
    const mrc = host.querySelector("#chip-MRC")!;
    expect(mrc.className).toMatch(/\bup\b/);
    expect(mrc.querySelector(".wake-badge")?.textContent).toBe(" 3×");
  });
});

describe("F14 · the ADD panel uses the screener chips", () => {
  const cards = [card("LEAVE1", { bucket: "LEAVE", status: "rejected", failingGateNames: ["moves", "tape"], netKd: 5 }), card("MRC", { netKd: 2 }), card("KHOT", { netKd: 9, everTraded: true }), card("NEAR1", { bucket: "ONE_AWAY", status: "near_miss", failingGateNames: ["profit floor"], netKd: 1 })];
  const render = () => act(async () => { root.render(<SymbolSearch show all={cards} budgetKd={700} onPick={() => {}} onClose={() => {}} />); });
  const rows = () => [...host.querySelectorAll(".addlist .pl:not(.none) .s")].map((e) => e.textContent);
  it("renders the seven chips with TODAY's labels, sorted TAKE first then by net", async () => {
    await render();
    const chips = [...host.querySelectorAll("#add-filters button")].map((b) => b.textContent);
    expect(chips).toHaveLength(SCREENER_FILTERS.length);
    expect(chips).toContain("REACHABLE AT 700 KD");
    expect(chips).toContain("PASSES EVERY GATE");
    expect(rows()).toEqual(["KHOT", "MRC", "NEAR1", "LEAVE1"]);
    expect(host.querySelector("#add-summary-count")?.textContent).toBe("4 screened today");
  });
  it("PASSES EVERY GATE and NEVER TRADED narrow the list the way TODAY does", async () => {
    await render();
    await act(async () => { (host.querySelector("#add-filter-PASSES") as HTMLButtonElement).click(); });
    expect(rows()).toEqual(["KHOT", "MRC"]);
    expect(host.querySelector("#add-summary-count")?.textContent).toBe("2 of 4");
    await act(async () => { (host.querySelector("#add-filter-NEVER_TRADED") as HTMLButtonElement).click(); });
    expect(rows()).toEqual(["MRC", "NEAR1", "LEAVE1"]);
  });
});
