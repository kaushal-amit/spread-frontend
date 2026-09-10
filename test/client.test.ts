/**
 * The request layer's controls: timeout, external cancellation, network-error
 * mapping, and clean HTTP-error surfacing. These are what stop a hung backend
 * from stalling a poll loop, an out-of-order response from clobbering fresh
 * state, and a raw fetch message from leaking to the UI.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { apiGet } from "../src/api/client";

const jsonResp = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? "OK" : "ERR",
  text: () => Promise.resolve(JSON.stringify(body)),
}) as unknown as Response;

// A fetch that never resolves on its own but rejects with an AbortError the
// moment its signal aborts — the shape a real fetch has under abort/timeout.
const abortableFetch = () =>
  vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise<Response>((_res, rej) => {
    init.signal.addEventListener("abort", () => {
      const e = new Error("aborted"); (e as Error).name = "AbortError"; rej(e);
    });
  }));

describe("client · request controls", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResp({ a: 1 }))));
    await expect(apiGet<{ a: number }>("/x")).resolves.toEqual({ a: 1 });
  });

  it("maps an HTTP error to ApiError carrying the server's code and message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResp({ code: "OCCUPIED", error: "one symbol, one slot" }, 409))));
    await expect(apiGet("/x")).rejects.toMatchObject({ status: 409, code: "OCCUPIED", message: "one symbol, one slot" });
  });

  it("times out a hung request as ApiError 408 TIMEOUT (loop can recover)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", abortableFetch());
    const p = apiGet("/x", undefined, { timeoutMs: 5000 });
    const assertion = expect(p).rejects.toMatchObject({ status: 408, code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("re-throws an external cancel as AbortError, so a hook can ignore it", async () => {
    vi.stubGlobal("fetch", abortableFetch());
    const ac = new AbortController();
    const p = apiGet("/x", undefined, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps a network failure to ApiError 0 NETWORK without leaking the raw message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch: db-host:5432 secret"))));
    await expect(apiGet("/x")).rejects.toMatchObject({ status: 0, code: "NETWORK", message: "could not reach the server" });
  });
});
