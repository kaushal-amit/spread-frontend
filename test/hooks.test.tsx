// @vitest-environment jsdom
/**
 * usePolled correctness under real conditions, exercised through useReviewBoard
 * (pure usePolled, no socket): a normal load, an error surfacing, and the one
 * that matters most — an OUT-OF-ORDER response after a navigation must NOT
 * overwrite the current resource (latest wins).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// A controllable apiGet: each call parks a deferred promise, keyed by request
// path, that the test resolves/rejects by hand — so response ordering is ours.
type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const pending: Record<string, Deferred[]> = {};
vi.mock("../src/api/client", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    apiGet: vi.fn((path: string) => new Promise((resolve, reject) => {
      (pending[path] ||= []).push({ resolve, reject });
    })),
  };
});

import { useReviewBoard } from "../src/api/hooks";

const pathFor = (d: string) => `/review/session/${d}/symbols`;
let captured: ReturnType<typeof useReviewBoard>;
function Harness({ date }: { date: string }) {
  captured = useReviewBoard(date, true);
  return null;
}

describe("usePolled · request correctness", () => {
  let container: HTMLDivElement; let root: Root;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); for (const k of Object.keys(pending)) delete pending[k]; });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

  it("loads: pending → data, loading clears, no error", async () => {
    act(() => root.render(<Harness date="D1" />));
    expect(captured.loading).toBe(true);
    await act(async () => { pending[pathFor("D1")][0].resolve({ date: "D1", count: 2, symbols: [] }); });
    expect(captured.data).toMatchObject({ date: "D1", count: 2 });
    expect(captured.loading).toBe(false);
    expect(captured.error).toBeNull();
  });

  it("surfaces an error and clears loading; data is not invented", async () => {
    act(() => root.render(<Harness date="D1" />));
    await act(async () => { pending[pathFor("D1")][0].reject(Object.assign(new Error("boom"), { name: "ApiError" })); });
    expect(captured.error).toBeTruthy();
    expect(captured.data).toBeNull();
    expect(captured.loading).toBe(false);
  });

  it("latest wins: an out-of-order response from the previous date is DROPPED", async () => {
    act(() => root.render(<Harness date="D1" />));          // request for D1 parked
    act(() => root.render(<Harness date="D2" />));          // navigate → request for D2 parked, D1 superseded
    // Resolve D2 (current) first, then D1 (stale) LAST — the naive bug is D1 winning.
    await act(async () => { pending[pathFor("D2")][0].resolve({ date: "D2", count: 9, symbols: [] }); });
    expect(captured.data).toMatchObject({ date: "D2" });
    await act(async () => { pending[pathFor("D1")][0].resolve({ date: "D1", count: 1, symbols: [] }); });
    // The stale D1 response must not clobber D2.
    expect(captured.data).toMatchObject({ date: "D2" });
  });
});
