// @vitest-environment jsdom
/**
 * F8 · the ladder shows the server's flow markers and banners:
 *   a PLACED / WALKDOWN row carries its class and note; the legend lists the
 *   markers present once each; DOUBLE WALL / CLOSING BID banners lead the ladder;
 *   flow notes appear; volumeDelta null says the flow was not computed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import type { Detail } from "../src/api/types";
import fixture from "./fixtures/detail.json";

vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, apiPost: vi.fn(async () => ({ ok: true, contracts: [] })) };
});
vi.mock("socket.io-client", () => ({ io: () => ({ connected: true, on: () => {}, off: () => {}, emit: () => {} }) }));

import { StockDetail } from "../src/components/StockDetail";

const base = (): Detail => JSON.parse(JSON.stringify((fixture as { body: Detail }).body));
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (d: Detail) => act(async () => {
  root.render(<StockDetail symbol={d.symbol} detail={d} error={null} loading={false} detailAt={Date.now()} bookAt={Date.now()} connected stops={null} onChanged={() => {}} onFeed={() => {}} />);
});

describe("F8 · flow markers and banners", () => {
  it("rows carry the server's marker class and note; the legend lists each marker once", async () => {
    const d = base();
    d.orderBook!.bids = [
      { price: 246, qty: 120000, changed: "same", markers: [{ event: "AGED", text: "held 40m" }, { event: "PLACED", text: "+70,000, nothing traded" }] },
      { price: 245, qty: 50000, changed: "same", markers: [{ event: "RELOCATED", text: "50,000 moved from 247" }] },
      { price: 240, qty: 155000, changed: "same", markers: [{ event: "PARKED", text: "parked, 0 changes" }, { event: "SHELF", text: "round number — stops sit here" }] },
    ];
    d.orderBook!.offers = [{ price: 251, qty: 40000, changed: "same", markers: [{ event: "WALKDOWN", text: "walk-down, step 3" }] }];
    d.orderBook!.volumeDelta = 0; d.orderBook!.banners = []; d.orderBook!.flowNotes = [];
    await render(d);
    // (248 is the position's entry and wears the "entry" mark — the operator's own order wins a row.)
    const rows = [...host.querySelectorAll(".lr")];
    const row = (px: number) => rows.find((r) => r.querySelector(".px")?.textContent === String(px))!;
    expect(row(246).className).toMatch(/bk-aged/);
    expect(row(246).querySelector(".note")?.textContent).toMatch(/held 40m · \+70,000, nothing traded/);
    expect(row(245).className).toMatch(/bk-relocated/);
    expect(row(251).className).toMatch(/bk-walkdown/);
    expect(row(251).querySelector(".note")?.textContent).toBe("walk-down, step 3");
    const legend = [...host.querySelectorAll("#ladder-legend .bk-legend-item .lbl")].map((e) => e.textContent);
    expect(legend).toEqual(["aged", "placed", "relocated", "parked", "shelf", "walkdown"]);
    expect(host.querySelector("#flow-not-computed")).toBeNull();
  });

  it("banners lead the ladder; flow notes and the not-computed line show", async () => {
    const d = base();
    d.orderBook!.banners = [{ type: "DOUBLE WALL", text: "both sides walled — 100,000 bid, 40,000 offered, nothing trading" }, { type: "CLOSING BID", text: "1,827,769 bid at 224 at 2026-09-09's close, 20,000 at this morning's first capture, nothing traded — an observation: whether resting bids survive the close is not established" }];
    d.orderBook!.flowNotes = ["bid 207 × 50,000 gone, nothing traded — pulled"];
    d.orderBook!.volumeDelta = 0;
    await render(d);
    const banners = [...host.querySelectorAll(".bk-banner")];
    expect(banners.map((b) => b.getAttribute("data-banner"))).toEqual(["DOUBLE WALL", "CLOSING BID"]);
    expect(banners[0].className).toMatch(/bk-banner-doublewall/);
    expect(banners[1].className).toMatch(/bk-banner-observation/);
    expect(banners[1].textContent).toMatch(/1,827,769 bid at 224/);
    // the banners come before the BOOK line
    const lad = host.querySelector("#ladder-dom")!;
    expect([...lad.children].findIndex((c) => c.classList.contains("bk-banner"))).toBeLessThan([...lad.children].findIndex((c) => c.id === "book-flow"));
    expect(host.querySelector("#flow-note-0")?.textContent).toMatch(/207 × 50,000 gone/);
    // a second render with no volume reading says the flow was not computed
    act(() => root.unmount()); root = createRoot(host);
    const e = base();
    e.orderBook!.bids = [{ price: 248, qty: 1, changed: "same" }, { price: 247, qty: 1, changed: "same" }];
    e.orderBook!.volumeDelta = null; e.orderBook!.banners = []; e.orderBook!.flowNotes = [];
    await render(e);
    expect(host.querySelector("#flow-not-computed")?.textContent).toMatch(/flow not computed/);
    expect(host.querySelectorAll(".bk-banner")).toHaveLength(0);
  });
});
