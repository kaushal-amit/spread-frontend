// @vitest-environment jsdom
/**
 * trading-states on the detail page:
 *   F1  a partial buy is PART FILLED — REST FILLED / CANCEL THE REST write to
 *       /trading/resolve-rest; a partial offer keeps QUEUED OFFER with the rest
 *   F2  contract.stopHitAt → the verdict is STOP HIT, the close leads, the
 *       ladder marks the stop
 *   F3/F4 a non-TAKE card reads TAKE IT ANYWAY and needs a reason; the post
 *       carries override + overrideReason; a 409 OUTSIDE_SIZE_BAND from the
 *       server turns POST BID into TAKE IT ANYWAY with the server's words;
 *       a structural card offers nothing
 *   F5  in Trading at Last the close is CLOSE AT AUCTION PRICE and enabled;
 *       POST OFFER is not
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import type { Detail } from "../src/api/types";
import fixture from "./fixtures/detail.json";

const posts: { path: string; body: unknown }[] = [];
let nextReject: { code: string; message: string; detail?: string } | null = null;
vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    apiPost: vi.fn(async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (nextReject) { const e = Object.assign(new Error(nextReject.message), nextReject); nextReject = null; throw e; }
      return { ok: true, contracts: [] };
    }),
  };
});
const fakeSocket = { connected: true, on: () => {}, off: () => {}, emit: () => {} };
vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

import { StockDetail } from "../src/components/StockDetail";

const base = (): Detail => JSON.parse(JSON.stringify((fixture as { body: Detail }).body));
const openSession = { open: true, phase: "peak", note: "", canClose: true, tal: false };
const stops = { canOpen: true, mode: "trade", reasons: [], timeStops: [] } as never;

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); posts.length = 0; nextReject = null; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = (d: Detail) => act(async () => {
  root.render(<StockDetail symbol={d.symbol} detail={d} error={null} loading={false}
    detailAt={Date.now()} bookAt={Date.now()} connected stops={stops} onChanged={() => {}} onFeed={() => {}} />);
});
const button = (id: string) => host.querySelector(`#${id}`) as HTMLButtonElement | null;
const click = (id: string) => act(async () => { button(id)!.click(); await Promise.resolve(); });
const type = (sel: string, v: string) => act(async () => {
  const el = host.querySelector(sel) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("F1 · PART FILLED", () => {
  it("a buy with its rest queued shows REST FILLED / CANCEL THE REST and writes to /trading/resolve-rest", async () => {
    const d = base();
    d.session = openSession;
    d.contract!.shares = 1200; d.contract!.boughtShares = 1200; d.contract!.restingBuyShares = 800;
    d.legs = [{ ...d.legs[0], shares: 2000, filledShares: 1200, restStatus: "POSTED", restingShares: 800 }];
    await render(d);
    expect(host.querySelector(".verb .v")?.textContent).toBe("PART FILLED");
    expect(host.textContent).toMatch(/1,200 of 2,000 filled/);
    expect(host.textContent).toMatch(/800 still resting/);
    expect(host.textContent).toMatch(/two fills cost two commissions/);
    expect(button("btn-rest-filled")).not.toBeNull();
    expect(button("btn-cancel-rest")).not.toBeNull();
    expect(button("btn-post-offer")).toBeNull();
    // the close waits for the rest: disabled, with the order of operations
    expect(button("btn-get-out")!.disabled).toBe(true);
    expect(host.querySelector("#detail-close-after-rest")?.textContent).toMatch(/CANCEL THE REST here, then hit the bid/);
    await click("btn-rest-filled");
    expect(posts[0].path).toBe("/trading/resolve-rest");
    expect(posts[0].body).toMatchObject({ legId: 341, status: "FILLED" });
    await click("btn-cancel-rest");
    expect(posts[1]).toMatchObject({ path: "/trading/resolve-rest", body: { legId: 341, status: "CANCELLED" } });
    // the ladder names the rest on the bid row
    expect(host.textContent).toMatch(/my bid · 800 rest/);
  });

  it("a partial OFFER keeps QUEUED OFFER; its buttons resolve the rest, not the leg", async () => {
    const d = base();
    d.session = openSession;
    d.legs = [d.legs[0], { id: 342, seq: 1, side: "SELL", status: "FILLED", price: 251, shares: 3000, filledShares: 1000, commissionKd: 0.5,
      postedAt: "2001-01-08T09:10:00.000Z", resolvedAt: "2001-01-08T09:11:00.000Z", note: "", exitVenue: "LIMIT", restStatus: "POSTED", restingShares: 2000 }];
    d.contract!.shares = 2000;
    await render(d);
    expect(host.querySelector(".verb .v")?.textContent).toBe("QUEUED OFFER");
    expect(host.textContent).toMatch(/Selling 2,000 at 251 \(the rest of a 1,000-share partial\)/);
    expect(button("btn-offer-filled")?.textContent).toBe("REST FILLED");
    expect(button("btn-offer-cancelled")?.textContent).toBe("CANCEL THE REST");
    await click("btn-offer-cancelled");
    expect(posts[0]).toMatchObject({ path: "/trading/resolve-rest", body: { legId: 342, status: "CANCELLED" } });
  });
});

describe("F2 · STOP HIT", () => {
  it("stopHitAt on the contract makes the verdict STOP HIT, the close leads, the stop row is marked", async () => {
    const d = base();
    d.session = openSession;
    d.contract!.stopFils = 246; d.contract!.stopHitAt = "2026-09-10T08:00:00Z"; d.contract!.bid = 245;
    d.stop = { symbol: d.symbol, stopFils: 246, fixedAtFill: true, hitAt: "2026-09-10T08:00:00Z", reason: "set at the fill — the bid has printed through it: HIT THE BID" };
    // the ladder has a level at the stop, so the row can carry the mark
    d.orderBook!.bids = [...d.orderBook!.bids, { price: 246, qty: 40000, changed: "same" }];
    await render(d);
    expect(host.querySelector(".verb .v")?.textContent).toBe("STOP HIT");
    expect(host.querySelector("#act-block")?.className).toMatch(/\bstop\b/);
    expect(host.textContent).toMatch(/printed through the 246 stop set at the fill/);
    const btns = [...host.querySelectorAll(".right button")].map((b) => b.id);
    expect(btns[0]).toBe("btn-get-out");
    expect(host.querySelector("#detail-stop")?.textContent).toMatch(/STOP HIT/);
    expect(host.querySelector(".lr.act-stop .note")?.textContent).toBe("STOP · HIT");
  });

  it("without a hit the stop line is the recorded one and the ladder marks it quietly", async () => {
    const d = base();
    d.session = openSession;
    d.contract!.stopFils = 246;
    d.stop = { symbol: d.symbol, stopFils: 246, fixedAtFill: true, hitAt: null, reason: "set at the fill from the aged shelf — fixed" };
    await render(d);
    expect(host.querySelector(".verb .v")?.textContent).toBe("HOLDING");
    expect(host.querySelector("#detail-stop")?.getAttribute("data-fixed")).toBe("1");
    expect(host.querySelector("#detail-stop")?.textContent).not.toMatch(/HIT/);
    expect(host.querySelector(".lr.act-stop")).toBeNull();
    // the offer comes first, the close second
    const btns = [...host.querySelectorAll(".right button")].map((b) => b.id);
    expect(btns.indexOf("btn-post-offer")).toBeLessThan(btns.indexOf("btn-get-out"));
  });
});

describe("F3 / F4 · TAKE IT ANYWAY", () => {
  const watch = (bucket: string, extra: Partial<Detail["candidate"] & object> = {}) => {
    const d = base();
    d.session = openSession; d.contract = null; d.legs = []; d.closedToday = [];
    d.sizing = { ...d.sizing, reachable: true, floor_kd: 333, ceiling_kd: 700, suggested_kd: 500, suggested_shares: 2000, reasons: [] };
    d.candidate = { ...d.candidate!, bucket: bucket as never, status: bucket === "TAKE" ? "recommended" : "near_miss", failingGateNames: bucket === "TAKE" ? [] : ["profit floor"], structuralReason: null, ...extra } as never;
    return d;
  };

  it("a TAKE card inside the band posts plainly", async () => {
    await render(watch("TAKE"));
    expect(button("btn-go-post")).not.toBeNull();
    expect(button("btn-take-anyway")).toBeNull();
    await click("btn-go-post");
    expect(posts[0].body).toMatchObject({ side: "BUY", status: "POSTED" });
    expect((posts[0].body as Record<string, unknown>).override).toBeUndefined();
  });

  it("a ONE AWAY card reads TAKE IT ANYWAY, needs a reason, and posts override + overrideReason", async () => {
    await render(watch("ONE_AWAY"));
    expect(button("btn-go-post")).toBeNull();
    const take = button("btn-take-anyway")!;
    expect(take.disabled).toBe(true);
    expect(host.querySelector("#detail-override-why")?.textContent).toMatch(/ONE AWAY, not TAKE — profit floor/);
    await type("#override-reason", "the floor is one fil away");
    expect(button("btn-take-anyway")!.disabled).toBe(false);
    await click("btn-take-anyway");
    expect(posts[0].body).toMatchObject({ side: "BUY", status: "POSTED", override: true, overrideReason: "the floor is one fil away" });
  });

  it("a 409 OUTSIDE_SIZE_BAND from the server turns POST BID into TAKE IT ANYWAY with the server's words", async () => {
    await render(watch("TAKE"));
    nextReject = { code: "OUTSIDE_SIZE_BAND", message: "SZTESTABAR: 20 KD is under the 333 KD floor", detail: "band 333–700 KD" };
    await click("btn-go-post");
    expect(host.textContent).toMatch(/OUTSIDE_SIZE_BAND: SZTESTABAR: 20 KD is under the 333 KD floor/);
    expect(button("btn-take-anyway")).not.toBeNull();
    expect(host.querySelector("#detail-override-why")?.textContent).toMatch(/20 KD is under the 333 KD floor/);
    await type("#override-reason", "sizing down on purpose");
    await click("btn-take-anyway");
    expect(posts[1].body).toMatchObject({ override: true, overrideReason: "sizing down on purpose" });
  });

  it("a plain REFUSED never offers an override; a structural card says so up front", async () => {
    await render(watch("TAKE"));
    nextReject = { code: "REFUSED", message: "no new position: breadth 24%" };
    await click("btn-go-post");
    expect(button("btn-take-anyway")).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
    await render(watch("LEAVE", { structuralReason: "OUT_OF_REACH" as never }));
    expect(button("btn-take-anyway")).toBeNull();
    expect(host.querySelector("#detail-structural")?.textContent).toMatch(/out of reach — arithmetic, not judgement: no override/);
  });
});

describe("F5 · Trading at Last", () => {
  it("canClose without open: CLOSE AT AUCTION PRICE is enabled, POST OFFER is not", async () => {
    const d = base();
    d.session = { open: false, phase: "tal", note: "Trading at Last to 13:30 — close at the auction price only", canClose: true, tal: true };
    await render(d);
    const close = button("btn-get-out")!;
    expect(close.textContent).toBe("CLOSE AT AUCTION PRICE");
    expect(close.disabled).toBe(false);
    expect(button("btn-post-offer")!.disabled).toBe(true);
    await click("btn-get-out");
    expect(posts[0].path).toBe("/trading/hit-bid");
  });

  it("closed and not TAL: the close is disabled and the note says why", async () => {
    const d = base();
    d.session = { open: false, phase: "closed", note: "session over", canClose: false, tal: false };
    await render(d);
    expect(button("btn-get-out")!.disabled).toBe(true);
    expect(host.textContent).toMatch(/no close now — session over/);
  });
});
