// @vitest-environment jsdom
/**
 * Parity items (10 Sep) on the live surfaces:
 *   C5  the chart view draws /candles for the FOCUSED symbol; an error is the
 *       server's sentence, zero candles is a statement, no symbol is nothing
 *   B5  slot chips come from the scraper's slotCount — the held ones as tiles,
 *       the rest as `free` — never a literal 8
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const pending: Record<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }[]> = {};
vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    apiGet: vi.fn((path: string) => new Promise((resolve, reject) => { (pending[path] ||= []).push({ resolve, reject }); })),
  };
});
const fakeSocket = { connected: true, on: () => {}, off: () => {}, emit: () => {} };
vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

// The socket plan · the slots, the board and the contracts are SECTIONS of the
// snapshot store; the tests apply one directly.
import { applySnapshot, _reset } from "../src/api/snapshot";
const slotsSnap = (slots: unknown) => applySnapshot({ seq: 1, at: "x", tradingDay: "2026-09-10", budgetKd: 700, partial: false, parts: ["slots", "board", "contracts"], final: false, reason: "test",
  slots: slots as never, board: { tradingDay: "2026-09-10", budgetKd: 700, take: [], oneAway: [], priceWarn: [], leave: [], recommended: [], nearMiss: [], rejected: [], notComputed: [], counts: {}, reach: null, session: { open: true, phase: "peak", note: "" }, coverage: null } as never, contracts: [] });

import { CandleChart } from "../src/components/CandleChart";
import { BooksView } from "../src/live/BooksView";

let root: Root, host: HTMLDivElement;
beforeEach(() => { _reset(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); for (const k of Object.keys(pending)) delete pending[k]; });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("CandleChart · the chart view is /candles for the focused symbol", () => {
  it("renders nothing without a symbol", () => {
    act(() => root.render(<CandleChart symbol={null} />));
    expect(host.querySelector("#candle-chart")).toBeNull();
    expect(pending["/candles/"]).toBeUndefined();
  });

  it("draws one candle per row from GET /candles/:symbol, and the timeframe re-fetches at the server's grain", async () => {
    act(() => root.render(<CandleChart symbol="ABAR" />));
    expect(pending["/candles/ABAR"]).toHaveLength(1);
    await act(async () => { pending["/candles/ABAR"][0].resolve({ symbol: "ABAR", intervalMinutes: 5, grain: "intraday", candles: [
      { time: "2026-09-10T06:00:00Z", open: 200, high: 203, low: 199, close: 202, volume: 1000 },
      { time: "2026-09-10T06:05:00Z", open: 202, high: 202, low: 198, close: 199, volume: 500 },
    ] }); });
    expect(host.querySelectorAll("g.candle")).toHaveLength(2);
    expect(host.textContent).toMatch(/2 candles · 198–203 fils/);
    act(() => { (host.querySelector("#tf-1D") as HTMLButtonElement).click(); });
    await flush();
    expect(host.querySelector("#candle-chart")?.getAttribute("data-minutes")).toBe("1440");
    // a second request went out for the new grain (the hook keys on params)
    expect(pending["/candles/ABAR"].length).toBeGreaterThanOrEqual(2);
  });

  it("zero candles is a statement, an error is the server's sentence", async () => {
    act(() => root.render(<CandleChart symbol="ABAR" />));
    await act(async () => { pending["/candles/ABAR"][0].resolve({ symbol: "ABAR", intervalMinutes: 5, grain: "intraday", candles: [] }); });
    expect(host.textContent).toMatch(/no candles for ABAR at this grain/);
    expect(host.querySelector("svg")).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
    act(() => root.render(<CandleChart symbol="KHOT" />));
    await act(async () => { pending["/candles/KHOT"][0].reject(new Error("symbol_day has no rows for KHOT")); });
    expect(host.textContent).toMatch(/candles: symbol_day has no rows for KHOT/);
  });
});

describe("BooksView · slot chips follow the scraper's slotCount", () => {
  it("2 held of 5 → two tiles, three `free` chips, and the header says 2 of 5", async () => {
    act(() => root.render(<BooksView />));
    await act(async () => { slotsSnap({ symbols: [{ slot: 1, symbol: "KHOT", code: null }, { slot: 3, symbol: "ABAR", code: null }], trading_date: "2026-09-10", slotCount: 5 }); });
    await flush();
    expect(host.querySelectorAll(".book-free")).toHaveLength(3);
    expect([...host.querySelectorAll(".book-free")].map((e) => e.getAttribute("data-slot"))).toEqual(["2", "4", "5"]);
    expect(host.querySelector("#slot-count")?.textContent).toMatch(/2 of 5 slots held/);
  });

  it("no slotCount from the scraper → no free chips are invented", async () => {
    act(() => root.render(<BooksView />));
    await act(async () => { slotsSnap({ symbols: [{ slot: 1, symbol: "KHOT", code: null }], trading_date: "2026-09-10" }); });
    await flush();
    expect(host.querySelectorAll(".book-free")).toHaveLength(0);
    expect(host.querySelector("#slot-count")?.textContent).toMatch(/^1 slot /);
  });

  it("a slots section the server could not build is the slots ERROR on the bar, never an empty strip", async () => {
    act(() => root.render(<BooksView />));
    await act(async () => { slotsSnap({ error: { code: "NOT_READY", error: "the scraper did not answer /depth-symbols" } }); });
    await flush();
    expect(host.querySelector(".book-err")?.textContent).toMatch(/slots: the scraper did not answer/);
  });
});
