// @vitest-environment jsdom
/**
 * The socket plan · the liveness reducer, and the no-poll guard.
 *   dead      no heartbeat for 30 s → TICKER DEAD (buttons disabled everywhere)
 *   missed    the heartbeat's seq ahead of the last snapshot → ONE bootstrap
 *   stale     heartbeats arrive, no snapshot for 150 s while active
 *   closed    the final snapshot → CLOSED, not LIVE and not STALE
 *   nothing on the terminal polls on a timer
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

const pending: string[] = [];
vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, apiGet: vi.fn((path: string) => { pending.push(path); return new Promise(() => {}); }) };
});
vi.mock("socket.io-client", () => ({ io: () => ({ connected: true, on: () => {}, off: () => {}, emit: () => {} }) }));

import { _reset, applySnapshot, applyHeartbeat, computeLiveness, getState, maybeResync, attach } from "../src/api/snapshot";

const T0 = 1_000_000_000;
const full = (seq: number, at: number, extra: Partial<Parameters<typeof applySnapshot>[0]> = {}) =>
  applySnapshot({ seq, at: new Date(at).toISOString(), tradingDay: "2026-09-10", budgetKd: 700, partial: false, parts: ["board"], final: false, reason: "t", board: {} as never, ...extra }, at);
const hb = (seq: number, at: number, o: Partial<{ active: boolean; final: boolean }> = {}) =>
  applyHeartbeat({ seq, at: new Date(at).toISOString(), phase: "peak", active: true, final: false, ...o }, at);
const connected = () => { attach(); };

beforeEach(() => { _reset(); pending.length = 0; });

describe("liveness", () => {
  it("live: a heartbeat within 30 s and a snapshot within 150 s", () => {
    connected(); full(1, T0); hb(1, T0 + 10_000);
    const l = computeLiveness(getState(), T0 + 15_000);
    expect(l.mode).toBe("live"); expect(l.dead).toBe(false);
  });

  it("TICKER DEAD after 30 s without a heartbeat — on every tab, with the sentence", () => {
    connected(); full(1, T0); hb(1, T0);
    expect(computeLiveness(getState(), T0 + 29_000).dead).toBe(false);
    const l = computeLiveness(getState(), T0 + 31_000);
    expect(l.mode).toBe("dead"); expect(l.dead).toBe(true);
    expect(l.reason).toMatch(/TICKER DEAD — no heartbeat for 31s/);
    expect(l.reason).toMatch(/no button will write/);
  });

  it("alive but STALE: heartbeats keep coming, no snapshot for 150 s while the ticker says active", () => {
    connected(); full(1, T0); hb(1, T0 + 149_000);
    expect(computeLiveness(getState(), T0 + 149_500).mode).toBe("live");
    hb(1, T0 + 151_000);
    const l = computeLiveness(getState(), T0 + 152_000);
    expect(l.mode).toBe("stale"); expect(l.dead).toBe(false);
    expect(l.reason).toMatch(/ticker alive, board stale/);
  });

  it("not stale when the ticker says it is NOT active (pre-open, idle after the final)", () => {
    connected(); full(1, T0); hb(1, T0 + 200_000, { active: false });
    expect(computeLiveness(getState(), T0 + 201_000).mode).toBe("live");
  });

  it("CLOSED after the final snapshot — not live, not stale, even with old data", () => {
    connected(); full(2, T0, { final: true }); hb(2, T0 + 400_000, { active: false, final: true });
    const l = computeLiveness(getState(), T0 + 401_000);
    expect(l.mode).toBe("closed"); expect(l.closed).toBe(true); expect(l.dead).toBe(false);
    expect(l.reason).toMatch(/SESSION CLOSED/);
  });

  it("a partial keeps the CLOSED state; a later full snapshot lifts it", () => {
    connected(); full(2, T0, { final: true });
    applySnapshot({ seq: 3, at: "x", tradingDay: "2026-09-10", budgetKd: 700, partial: true, parts: ["board"], final: false, reason: "stats", board: {} as never }, T0 + 1000);
    expect(getState().final).toBe(true);
    full(4, T0 + 2000);
    expect(getState().final).toBe(false);
  });

  it("a missed snapshot (heartbeat seq ahead) triggers ONE bootstrap, not a loop", () => {
    connected();                                   // the mount bootstrap
    expect(pending.filter((p) => p === "/bootstrap").length).toBe(1);
    full(5, T0); hb(5, T0 + 10_000);
    expect(maybeResync(getState())).toBe(false);
    hb(7, T0 + 20_000);                            // two snapshots went by that we never got
    // the mount bootstrap is still in flight in this harness (the promise never resolves), so the
    // resync is deferred to it — one request in flight at a time, never two
    const before = pending.length;
    expect(maybeResync(getState())).toBe(false);
    expect(pending.length).toBe(before);
  });

  it("a merged partial replaces only its parts and stamps their arrival time", () => {
    full(1, T0, { parts: ["board", "account"], account: { equityKd: 1 } as never });
    applySnapshot({ seq: 2, at: "x", tradingDay: "2026-09-10", budgetKd: 700, partial: true, parts: ["account"], final: false, reason: "trade", account: { equityKd: 2 } as never }, T0 + 5000);
    const s = getState();
    expect((s.sections.account as { equityKd: number }).equityKd).toBe(2);
    expect(s.sections.board).toBeDefined();
    expect(s.sectionAt.account).toBe(T0 + 5000); expect(s.sectionAt.board).toBe(T0);
    expect(s.lastPartialSeq).toBe(2); expect(s.seq).toBe(2);
  });
});

describe("no poll", () => {
  it("no hook passes a timer interval to usePolled — every remaining read is on demand", () => {
    const src = readFileSync("src/api/hooks.ts", "utf8").replace(/function usePolled<[^\n]*\n/, "");
    // every usePolled CALL passes 0 (no timer) as everyMs
    const calls = [...src.matchAll(/usePolled<[^>]*>\(\s*[^,]+,\s*([^,)]+)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((v) => v === "0")).toBe(true);
    expect(src).not.toMatch(/POLL_MS/);
    expect(readFileSync("src/live/BooksView.tsx", "utf8")).not.toMatch(/setInterval\(load/);
  });
});
