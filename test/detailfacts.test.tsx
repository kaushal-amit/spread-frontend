// @vitest-environment jsdom
/**
 * detail-facts on the surfaces:
 *   F6  the hold grid renders the server's holdFacts — a number where computed,
 *       "—" with the reason where not; only while a position is held
 *   F7  TODAY prints the snapshot's fits line under WORTH TAKING, and nothing
 *       when the budget section has none
 *   F9  STATES lists the contract states with a live SEE symbol, the card
 *       buckets, the session rows with `now` marked
 *   F12 the progress strip marks the phase
 *   F13 DONE shows bought / sold / net per contract and the day
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import type { Detail, TradingContract, Budget, HoldFacts } from "../src/api/types";
import fixture from "./fixtures/detail.json";

vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, apiPost: vi.fn(async () => ({ ok: true, contracts: [] })), apiGet: vi.fn(() => new Promise(() => {})) };
});
const fakeSocket = { connected: true, on: () => {}, off: () => {}, emit: () => {} };
vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

import { StockDetail } from "../src/components/StockDetail";
import { StatesView } from "../src/components/StatesView";
import { TodayView } from "../src/components/TodayView";

const base = (): Detail => JSON.parse(JSON.stringify((fixture as { body: Detail }).body));
const openSession = { open: true, phase: "peak", note: "", canClose: true, tal: false };
const stops = { canOpen: true, mode: "trade", reasons: [], timeStops: [], pastFlatBy: false } as never;
const facts: HoldFacts = {
  mark: { computed: true, bidFils: 249, entryFils: 248, unrealisedKd: 3, markedAt: null },
  bidProtected: { computed: true, qty: 120000, thresholdQty: 20000, protectedNow: true, agedBelow: true, note: "120,000 at the touch" },
  exitAt: { computed: true, targetNormal: 250, targetTrending: 254, breakEven: 250, stopFils: 246 },
  volume: { computed: false, reason: "volume ratio not computed for this symbol (stats:daily)" },
  ceiling: { computed: true, priceFils: 255, qty: 400000, presencePct: 96, note: "255 × 400,000 — present 96% of the session" },
  refill: { computed: false, reason: "not measured — the bid-rebuild count needs per-level change tracking (F8)" },
  exitOk: { computed: true, offerQty: 12000, yourShares: 3000, multiple: 4, thresholdX: 3, ok: false, note: "offer 12,000 = 4.0× your 3,000 — over 3×, you queue behind it" },
};

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const renderDetail = (d: Detail, dayKd: number | null = null) => act(async () => {
  root.render(<StockDetail symbol={d.symbol} detail={d} error={null} loading={false} detailAt={Date.now()} bookAt={Date.now()} connected stops={stops} dayKd={dayKd} onChanged={() => {}} onFeed={() => {}} />);
});

describe("F6 · the hold grid", () => {
  it("renders each fact: numbers where computed, — with the reason where not", async () => {
    const d = base(); d.session = openSession; d.holdFacts = facts;
    await renderDetail(d);
    const grid = host.querySelector("#hold-facts")!;
    expect(grid).not.toBeNull();
    const cells = [...grid.querySelectorAll(".f")];
    expect(cells).toHaveLength(7);
    expect(cells.map((c) => c.querySelector(".l")!.textContent)).toEqual(["MARK", "BID PROTECTED", "EXIT AT", "VOLUME", "CEILING", "REFILL", "EXIT OK"]);
    expect(cells[0].querySelector(".v")!.textContent).toBe("249");
    expect(cells[0].className).toMatch(/good/);
    expect(cells[1].querySelector(".v")!.textContent).toBe("120,000");
    expect(cells[3].getAttribute("data-computed")).toBe("0");
    expect(cells[3].querySelector(".v")!.textContent).toBe("—");
    expect(cells[3].querySelector(".x")!.textContent).toMatch(/not computed for this symbol/);
    expect(cells[5].querySelector(".x")!.textContent).toMatch(/not measured/);
    expect(cells[6].querySelector(".v")!.textContent).toBe("4×");
    expect(cells[6].className).toMatch(/bad/);
    expect(cells[6].querySelector(".x")!.textContent).toMatch(/queue behind it/);
  });
  it("is absent on WATCH and DONE", async () => {
    const d = base(); d.session = openSession; d.holdFacts = facts; d.contract = null; d.legs = []; d.closedToday = [];
    await renderDetail(d);
    expect(host.querySelector("#hold-facts")).toBeNull();
  });
});

describe("F12 / F13 · the strip and the DONE block", () => {
  it("HOLDING lights the third step", async () => {
    const d = base(); d.session = openSession;
    await renderDetail(d);
    expect(host.querySelector("#phase-progress")?.getAttribute("data-step")).toBe("2");
    expect(host.querySelector(".proglab b")?.textContent).toBe("FILLED");
    expect(host.querySelectorAll("#phase-progress i.done")).toHaveLength(2);
  });
  it("DONE lists bought / sold / net per contract and the day from the account", async () => {
    const d = base(); d.session = openSession; d.contract = null; d.legs = [];
    d.closedToday = [{ seq: 1, entry: 248, exit: 251, shares: 3000, netKd: 5.6, feesKd: 3.4 }];
    await renderDetail(d, 12.3);
    expect(host.querySelector("#phase-progress")?.getAttribute("data-step")).toBe("4");
    const done = host.querySelector("#done-facts")!;
    const labels = [...done.querySelectorAll(".f .l")].map((e) => e.textContent);
    expect(labels).toEqual(["C1 BOUGHT", "SOLD", "NET", "DAY"]);
    expect([...done.querySelectorAll(".f .v")].map((e) => e.textContent)).toEqual(["248", "251", "+5.60", "+12.30"]);
    expect(done.textContent).toMatch(/\+3 fils/);
  });
  it("DONE with the account not loaded says so instead of a zero", async () => {
    const d = base(); d.session = openSession; d.contract = null; d.legs = [];
    d.closedToday = [{ seq: 1, entry: 248, exit: 251, shares: 3000, netKd: 5.6, feesKd: 3.4 }];
    await renderDetail(d, null);
    const day = [...host.querySelectorAll("#done-facts .f")].pop()!;
    expect(day.querySelector(".v")!.textContent).toBe("—");
    expect(day.querySelector(".x")!.textContent).toMatch(/account not loaded/);
  });
});

describe("F7 · the fits line on TODAY", () => {
  const live = <T,>(data: T | null) => ({ data, loading: false, error: null, at: Date.now(), refresh: () => {} }) as never;
  const card = (symbol: string) => ({ symbol, price: 200, bucket: "TAKE", status: "recommended", failingGateNames: [], notComputed: [], gateGroups: [], behaviourFlags: [], metrics: { targetTicks: 2 }, headroom: { minKd: 300 }, shares: 1000, netKd: 1, structuralReason: null }) as never;
  const board = (take: unknown[]) => ({ tradingDay: "2026-09-10", budgetKd: 700, take, oneAway: [], priceWarn: [], leave: [], notComputed: [], all: take, counts: { all: take.length }, stops: null, recommended: take, nearMiss: [], rejected: [], reach: null, session: { open: true, phase: "peak", note: "" }, coverage: null }) as never;
  const budget = (fits?: Budget["fits"]): Budget => ({ budget_kd: 720, reserve_kd: 0, reserve_held: false, reserve_releases_at_hhmm: 1100, committed_kd: 0, open_positions: 0, free_kd: 720, min_position_kd: 333, max_price_fils: 333, fits });
  const render = (b: unknown, bud: Budget) => act(async () => {
    root.render(<TodayView board={b as never} boardError={null} boardLoading={false} connected boardAt={Date.now()} market={live(null)} budget={live(bud)} contracts={live([] as TradingContract[])} onPickSymbol={() => {}} />);
  });
  it("prints the server's line under WORTH TAKING", async () => {
    await render(board([card("MRC"), card("KHOT")]), budget({ freeKd: 720, remainingKd: 0, line: "Free 720 — MRC fits, KHOT needs 80 more", items: [{ symbol: "MRC", needKd: 300, computed: true, fits: true, deficitKd: 0 }, { symbol: "KHOT", needKd: 500, computed: true, fits: false, deficitKd: 80 }] }));
    expect(host.querySelector("#worth-taking-summary")?.textContent).toBe("Free 720 — MRC fits, KHOT needs 80 more");
    expect(host.querySelector("#worth-taking-summary")?.getAttribute("title")).toMatch(/KHOT: needs 500 KD — short 80/);
  });
  it("prints nothing when the budget section carries no fits (a REST read, or a budget-only partial)", async () => {
    await render(board([card("MRC")]), budget(undefined));
    expect(host.querySelector("#worth-taking-summary")).toBeNull();
  });
});

describe("F9 · the STATES catalogue is live", () => {
  const contract = (over: Partial<TradingContract>): TradingContract => ({ symbol: "ABAR", seq: 1, state: "holding", shares: 3000, entry: 248, bid: 249, offer: 251, committedKd: 744, unrealisedKd: 3, breakEvenPrice: 250, targetNormal: 250, targetTrending: 254, peakSinceFill: null, stepDownTime: "11:00", boughtShares: 3000, openedOn: "2026-09-10", markedAt: "quote", quoteAt: null, legs: [], ...over });
  const render = (contracts: TradingContract[] | null, phase = "peak", mode = "trade") => act(async () => {
    root.render(<StatesView contracts={contracts} board={null} session={{ phase, open: phase === "peak" } as never} stops={{ mode, timeStops: [{ symbol: "KHOT" }], pastFlatBy: false } as never} onPickSymbol={() => {}} />);
  });
  it("names the symbol in each state — PART FILLED, STOP HIT, QUEUED OFFER, TIME STOP — and `none today` otherwise", async () => {
    await render([
      contract({ symbol: "ABAR", restingBuyShares: 800 }),
      contract({ symbol: "MRC", stopHitAt: "2026-09-10T08:00:00Z" }),
      contract({ symbol: "CATTL", legs: [{ id: 1, contractId: 1, symbol: "CATTL", time: "", side: "SELL", status: "POSTED", price: 251, shares: 3000, commission_kd: 0, note: "" }] }),
    ]);
    const see = (state: string) => [...host.querySelectorAll(`tr[data-state="${state}"] .slot`)].map((e) => e.textContent);
    expect(see("PART FILLED")).toEqual(["ABAR"]);
    expect(see("STOP HIT")).toEqual(["MRC"]);
    expect(see("QUEUED OFFER")).toEqual(["CATTL"]);
    expect(see("TIME STOP")).toEqual(["KHOT"]);
    expect(see("HOLDING")).toEqual([]);
    expect(host.querySelector('tr[data-state="DONE"]')?.textContent).toMatch(/none today/);
    expect(host.querySelectorAll("#states-contract tbody tr")).toHaveLength(9);
    expect(host.querySelectorAll("#states-card tbody tr")).toHaveLength(6);
  });
  it("positions not loaded is said, not shown as none", async () => {
    await render(null);
    expect(host.querySelector('tr[data-state="HOLDING"]')?.textContent).toMatch(/positions not loaded/);
  });
  it("marks the session row that is now", async () => {
    await render([], "tal", "closed");
    const now = [...host.querySelectorAll("#states-session tr[data-now]")].map((r) => r.querySelector("td")!.textContent);
    expect(now).toEqual(["TRADING AT LAST", "CLOSED"]);
  });
});
