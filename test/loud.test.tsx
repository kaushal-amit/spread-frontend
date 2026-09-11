// @vitest-environment jsdom
/**
 * Loud, not plausible — the SPR-33 / §0 rules on the live surfaces:
 *   - a board the server could not compute is BOARD UNAVAILABLE, never a
 *     quiet "0 symbols · nothing passes every gate"
 *   - the detail ladder's clock moves only when a NEW capture arrives, so a
 *     server that repeats a stale capture every tick cannot keep it "fresh"
 *   - an empty-book push for a symbol outside the sweep does not wipe the
 *     REST ladder
 *   - no stops verdict is STOPS UNKNOWN, not silence
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// A hand-driven socket: the hooks subscribe, the test emits.
type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler[]> = {};
const emitted: { ev: string; arg: unknown }[] = [];
const fakeSocket = {
  connected: true,
  on: (ev: string, h: Handler) => { (handlers[ev] ||= []).push(h); },
  off: (ev: string, h: Handler) => { handlers[ev] = (handlers[ev] || []).filter((x) => x !== h); },
  emit: (ev: string, arg: unknown) => { emitted.push({ ev, arg }); },
};
const fire = (ev: string, arg: unknown) => (handlers[ev] || []).forEach((h) => h(arg));

const pending: Record<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }[]> = {};
vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    apiGet: vi.fn((path: string) => new Promise((resolve, reject) => { (pending[path] ||= []).push({ resolve, reject }); })),
  };
});
// getSocket() builds the singleton through socket.io-client's io(); the fake
// is injected there so the hooks' own internal calls get it too.
vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

import { useBoard, useDetail } from "../src/api/hooks";
import { SessionBanner } from "../src/components/SessionBanner";
import { _reset } from "../src/api/snapshot";

let root: Root, host: HTMLDivElement;
beforeEach(() => { _reset(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); for (const k of Object.keys(handlers)) delete handlers[k]; emitted.length = 0; });
afterEach(() => { act(() => root.unmount()); host.remove(); for (const k of Object.keys(pending)) delete pending[k]; });

const emptyBoard = { tradingDay: "2026-09-10", budgetKd: 800, take: [], oneAway: [], priceWarn: [], leave: [], recommended: [], nearMiss: [], rejected: [], notComputed: [],
  counts: {}, reach: null, session: { open: true, phase: "peak", note: "" }, coverage: null };
// The socket plan · the board arrives as a SECTION of spread:snapshot.
let seq = 0;
const snap = (board: unknown) => ({ seq: ++seq, at: new Date().toISOString(), tradingDay: "2026-09-10", budgetKd: 800, partial: false, parts: ["board"], final: false, reason: "test", board });

describe("useBoard · a board the server could not compute is an error, not an empty board", () => {
  let cap: ReturnType<typeof useBoard>;
  function H() { cap = useBoard(); return null; }

  it("a snapshot whose board carries `error` sets the board error with the server's code", async () => {
    act(() => root.render(<H />));
    await act(async () => { fire("spread:snapshot", snap({ ...emptyBoard, error: { code: "DB_DOWN", error: "the board could not be computed" } })); });
    expect(cap.error).not.toBeNull();
    expect((cap.error as { code?: string }).code).toBe("DB_DOWN");
    expect(cap.data?.all.length).toBe(0);
  });

  it("a computed board clears the error", async () => {
    act(() => root.render(<H />));
    await act(async () => { fire("spread:snapshot", snap({ ...emptyBoard, error: { code: "DB_DOWN", error: "x" } })); });
    await act(async () => { fire("spread:snapshot", snap({ ...emptyBoard, counts: { total: 0 }, error: null })); });
    expect(cap.error).toBeNull();
  });

  it("a board section the server could not BUILD ({ error } in its slot) is the board error too, never a quiet empty board", async () => {
    act(() => root.render(<H />));
    await act(async () => { fire("spread:snapshot", snap({ error: { code: "NOT_READY", error: "no session budget is set" } })); });
    expect((cap.error as { code?: string })?.code).toBe("NOT_READY");
    expect(cap.data).toBeNull();
  });
});

// the focus channel: the server pushes the FOCUSED symbol's quote/book/contract on change
const focusMsg = (book: { capturedAt: string | null; b: number[][]; o: number[][] }) => ({ symbol: "ABAR", at: new Date().toISOString(), quote: null, book, contract: null });

describe("useDetail · the ladder clock moves only on a NEW capture", () => {
  let cap: ReturnType<typeof useDetail>;
  function H() { cap = useDetail("ABAR", 0); return null; }
  const detail = { symbol: "ABAR", orderBook: { bids: [{ price: 200, qty: 1000, changed: "same" }], offers: [{ price: 201, qty: 500, changed: "same" }], lastTickTime: "2026-09-10T07:00:00Z" } };

  it("a repeated push of the SAME capture does not refresh bookAt; a new capturedAt does", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T07:00:10Z") });
    act(() => root.render(<H />));
    await act(async () => { pending["/stocks/ABAR/detail"][0].resolve(detail); });
    expect(cap.bookAt).toBeNull();
    await act(async () => { fire("spread:focus", focusMsg({ capturedAt: "2026-09-10T07:00:00Z", b: [[200, 1000]], o: [[201, 500]] })); });
    const first = cap.bookAt;
    expect(first).not.toBeNull();
    vi.setSystemTime(new Date("2026-09-10T07:05:00Z"));
    // the same capture again (a quote moved, the book did not) — the clock stays
    await act(async () => { fire("spread:focus", focusMsg({ capturedAt: "2026-09-10T07:00:00Z", b: [[200, 1000]], o: [[201, 500]] })); });
    expect(cap.bookAt).toBe(first);
    await act(async () => { fire("spread:focus", focusMsg({ capturedAt: "2026-09-10T07:04:50Z", b: [[200, 900]], o: [[201, 500]] })); });
    expect(cap.bookAt).not.toBe(first);
    expect(cap.data?.orderBook?.bids[0].qty).toBe(900);
    vi.useRealTimers();
  });

  it("an empty-book push (symbol outside the sweep) leaves the REST ladder alone", async () => {
    act(() => root.render(<H />));
    await act(async () => { pending["/stocks/ABAR/detail"][0].resolve(detail); });
    await act(async () => { fire("spread:focus", focusMsg({ capturedAt: null, b: [], o: [] })); });
    expect(cap.data?.orderBook?.bids.length).toBe(1);
    expect(cap.bookAt).toBeNull();
  });
});

describe("useDetail · the focus survives a reconnect", () => {
  function H() { useDetail("ABAR", 0); return null; }
  it("re-emits spread:focus on connect (the server keeps the focus per socket.id and a reconnect is a new id)", async () => {
    act(() => root.render(<H />));
    const before = emitted.filter((e) => e.ev === "spread:focus" && (e.arg as { symbol: string | null }).symbol === "ABAR").length;
    expect(before).toBe(1);
    await act(async () => { fire("connect", undefined); });
    const after = emitted.filter((e) => e.ev === "spread:focus" && (e.arg as { symbol: string | null }).symbol === "ABAR");
    expect(after.length).toBe(2);
  });
  it("leaving the symbol clears the focus (null), so the server stops pushing it", () => {
    act(() => root.render(<H />));
    act(() => root.unmount()); root = createRoot(host);
    expect(emitted.some((e) => e.ev === "spread:focus" && (e.arg as { symbol: string | null }).symbol === null)).toBe(true);
  });
});

describe("the socket plan · nothing polls", () => {
  it("useAccount is a SECTION of the snapshot: no GET /account ever, the value arrives by push", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { useAccount } = await import("../src/api/hooks");
    let cap: ReturnType<typeof useAccount> | null = null;
    function H() { cap = useAccount(); return null; }
    act(() => root.render(<H />));
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(pending["/account"]).toBeUndefined();
    expect((pending["/bootstrap"] || []).length).toBe(1);          // the one seed
    await act(async () => { fire("spread:snapshot", { seq: 9, at: "x", tradingDay: "2026-09-10", budgetKd: 800, partial: true, parts: ["account"], final: false, reason: "trade", account: { equityKd: 812.5 } }); });
    expect((cap as unknown as { data: { equityKd: number } }).data?.equityKd).toBe(812.5);
    expect((pending["/account"] || []).length).toBe(0);
    vi.useRealTimers();
  });

  it("an on-demand read (the candle grain) fetches on its inputs, never on a timer", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { useCandles } = await import("../src/api/hooks");
    function H({ m }: { m: number }) { useCandles("ABAR", m); return null; }
    act(() => root.render(<H m={5} />));
    expect((pending["/candles/ABAR"] || []).length).toBe(1);
    await act(async () => { vi.advanceTimersByTime(600_000); });   // ten minutes: no timer fires
    expect((pending["/candles/ABAR"] || []).length).toBe(1);
    act(() => root.render(<H m={60} />));                        // the grain changed → one read
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect((pending["/candles/ABAR"] || []).length).toBe(2);
    vi.useRealTimers();
  });
});

describe("SessionBanner · no verdict is STOPS UNKNOWN, never silence", () => {
  it("renders UNKNOWN for null stops", () => {
    act(() => root.render(<SessionBanner stops={null} />));
    expect(host.textContent).toMatch(/STOPS UNKNOWN/);
    expect(host.querySelector("#session-banner")?.getAttribute("data-mode")).toBe("unknown");
  });
  it("renders nothing for a clean tradable verdict", () => {
    act(() => root.render(<SessionBanner stops={{ mode: "trade", canOpen: true, reasons: [], warnings: [] } as never} />));
    expect(host.textContent).toBe("");
  });
});
