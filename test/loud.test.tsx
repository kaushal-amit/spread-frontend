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

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); for (const k of Object.keys(handlers)) delete handlers[k]; emitted.length = 0; });
afterEach(() => { act(() => root.unmount()); host.remove(); for (const k of Object.keys(pending)) delete pending[k]; });

const emptyBoard = { tradingDay: "2026-09-10", budgetKd: 800, recommended: [], nearMiss: [], rejected: [], notComputed: [],
  counts: {}, reach: null, session: { open: true, phase: "peak", note: "" }, coverage: null };

describe("useBoard · a board the server could not compute is an error, not an empty board", () => {
  let cap: ReturnType<typeof useBoard>;
  function H() { cap = useBoard(); return null; }

  it("spread:update with `error` sets the board error with the server's code", async () => {
    act(() => root.render(<H />));
    await act(async () => { fire("spread:update", { ...emptyBoard, error: { code: "DB_DOWN", error: "the board could not be computed" } }); });
    expect(cap.error).not.toBeNull();
    expect((cap.error as { code?: string }).code).toBe("DB_DOWN");
    expect(cap.data?.all.length).toBe(0);
  });

  it("a computed board clears the error", async () => {
    act(() => root.render(<H />));
    await act(async () => { fire("spread:update", { ...emptyBoard, error: { code: "DB_DOWN", error: "x" } }); });
    await act(async () => { fire("spread:update", { ...emptyBoard, counts: { total: 0 }, error: null }); });
    expect(cap.error).toBeNull();
  });
});

describe("useDetail · the ladder clock moves only on a NEW capture", () => {
  let cap: ReturnType<typeof useDetail>;
  function H() { cap = useDetail("ABAR", 0); return null; }
  const detail = { symbol: "ABAR", orderBook: { bids: [{ price: 200, qty: 1000, changed: "same" }], offers: [{ price: 201, qty: 500, changed: "same" }], lastTickTime: "2026-09-10T07:00:00Z" } };

  it("a repeated push of the SAME capture does not refresh bookAt; a new capturedAt does", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T07:00:10Z") });
    act(() => root.render(<H />));
    await act(async () => { pending["/stocks/ABAR/detail"][0].resolve(detail); });
    expect(cap.bookAt).toBeNull();
    await act(async () => { fire("spread:book", { symbol: "ABAR", book: { capturedAt: "2026-09-10T07:00:00Z", b: [[200, 1000]], o: [[201, 500]] } }); });
    const first = cap.bookAt;
    expect(first).not.toBeNull();
    vi.setSystemTime(new Date("2026-09-10T07:05:00Z"));
    // the server repeats the same capture every tick — the old code stamped Date.now() each time
    await act(async () => { fire("spread:book", { symbol: "ABAR", book: { capturedAt: "2026-09-10T07:00:00Z", b: [[200, 1000]], o: [[201, 500]] } }); });
    expect(cap.bookAt).toBe(first);
    await act(async () => { fire("spread:book", { symbol: "ABAR", book: { capturedAt: "2026-09-10T07:04:50Z", b: [[200, 900]], o: [[201, 500]] } }); });
    expect(cap.bookAt).not.toBe(first);
    expect(cap.data?.orderBook?.bids[0].qty).toBe(900);
    vi.useRealTimers();
  });

  it("an empty-book push (symbol outside the sweep) leaves the REST ladder alone", async () => {
    act(() => root.render(<H />));
    await act(async () => { pending["/stocks/ABAR/detail"][0].resolve(detail); });
    await act(async () => { fire("spread:book", { symbol: "ABAR", book: { capturedAt: null, b: [], o: [] } }); });
    expect(cap.data?.orderBook?.bids.length).toBe(1);
    expect(cap.bookAt).toBeNull();
  });
});

describe("useDetail · watches survive a reconnect", () => {
  function H() { useDetail("ABAR", 0); return null; }
  it("re-emits spread:watch on connect (the server's watch set is per socket.id and empty after a reconnect)", async () => {
    act(() => root.render(<H />));
    const before = emitted.filter((e) => e.ev === "spread:watch").length;
    expect(before).toBe(1);
    await act(async () => { fire("connect", undefined); });
    const after = emitted.filter((e) => e.ev === "spread:watch");
    expect(after.length).toBe(2);
    expect(after[1].arg).toEqual({ symbol: "ABAR" });
  });
});

describe("usePolled · a tick coalesces into the poll cadence instead of adding to it", () => {
  it("a signal inside half the interval does not refetch; one beyond it does and restarts the clock", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { useAccount } = await import("../src/api/hooks");
    let tick = 0;
    function H({ t }: { t: number }) { useAccount(t); return null; }
    const calls = () => (pending["/account"] || []).length;
    act(() => root.render(<H t={tick} />));
    expect(calls()).toBe(1);                              // the mount poll
    // tick 1 at +3 s: the mount fetch is 3 s old — under 15 s / 2 → no refetch
    await act(async () => { vi.advanceTimersByTime(3_000); });
    act(() => root.render(<H t={++tick} />));
    await act(async () => { vi.advanceTimersByTime(1_300); });   // past the 1.2 s debounce
    expect(calls()).toBe(1);
    // tick 2 at +10 s: 10 s old ≥ 7.5 s → ONE refetch, and the poll clock restarts
    await act(async () => { vi.advanceTimersByTime(5_700); });
    act(() => root.render(<H t={++tick} />));
    await act(async () => { vi.advanceTimersByTime(1_300); });
    expect(calls()).toBe(2);
    // the base poll would have fired at +15 s from mount; it does NOT (restarted at +11.3 s)
    await act(async () => { vi.advanceTimersByTime(4_000); });   // now +15.3 s
    expect(calls()).toBe(2);
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
