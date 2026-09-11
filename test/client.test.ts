// @vitest-environment jsdom
/**
 * The request layer's controls: timeout, external cancellation, network-error
 * mapping, and clean HTTP-error surfacing. These are what stop a hung backend
 * from stalling a poll loop, an out-of-order response from clobbering fresh
 * state, and a raw fetch message from leaking to the UI.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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

/**
 * D3 · the credential is the signed-in user's ID token, per request; the
 * depth slots go through the backend; an expired token is refreshed and
 * retried ONCE; a 403 UID_NOT_ALLOWED is broadcast for the gate.
 */
describe("client · D3: the ID token is the credential, the slots go through /api", () => {
  let token: string | null = "id-token-1";
  let forced = 0;
  beforeEach(() => {
    vi.resetModules();
    token = "id-token-1"; forced = 0;
    vi.doMock("../src/auth", () => ({
      configured: true,
      idToken: vi.fn(async (force?: boolean) => { if (force) { forced++; token = "id-token-2"; } return token; }),
      onUser: () => () => {}, signIn: async () => ({ uid: "u", email: null }), signOut: async () => {},
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.unstubAllGlobals(); vi.doUnmock("../src/auth"); });

  it("getSlots asks the BACKEND (/api/slots) with the ID token — never the scraper, never a static token", async () => {
    vi.stubEnv("VITE_API_BASE", "https://backend.example");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResp({ symbols: [], trading_date: "2026-09-10", slotCount: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    const live = await import("../src/live/api");
    const r = await live.getSlots();
    expect(r.slotCount).toBe(5);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://backend.example/api/slots");
    expect(init.headers.Authorization).toBe("Bearer id-token-1");
  });

  it("swapSlot POSTs /api/slots/:n and surfaces the relayed 409 sentence as the error message", async () => {
    vi.stubEnv("VITE_API_BASE", "https://backend.example");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResp({ ok: false, error: "One symbol, one slot — ABAR already holds slot 1" }, 409)));
    vi.stubGlobal("fetch", fetchMock);
    const live = await import("../src/live/api");
    await expect(live.swapSlot(2, "ABAR", "UI")).rejects.toMatchObject({ status: 409, message: /One symbol, one slot/ });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe("https://backend.example/api/slots/2");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ symbol: "ABAR", reason: "UI" });
  });

  it("a 401 TOKEN_EXPIRED refreshes the token (force) and retries ONCE", async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => { calls++; return Promise.resolve(calls === 1
      ? jsonResp({ code: "UNAUTHORISED", reason: "TOKEN_EXPIRED", error: "expired" }, 401)
      : jsonResp({ ok: true })); });
    vi.stubGlobal("fetch", fetchMock);
    const { apiGet: get } = await import("../src/api/client");
    await expect(get("/account")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(forced).toBe(1);
    const [, init2] = fetchMock.mock.calls[1] as unknown as [string, { headers: Record<string, string> }];
    expect(init2.headers.Authorization).toBe("Bearer id-token-2");
  });

  it("any other 401 is NOT retried, and carries the reason", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResp({ code: "UNAUTHORISED", reason: "BAD_TOKEN", error: "bad" }, 401)));
    vi.stubGlobal("fetch", fetchMock);
    const { apiGet: get } = await import("../src/api/client");
    await expect(get("/account")).rejects.toMatchObject({ status: 401, reason: "BAD_TOKEN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 403 UID_NOT_ALLOWED is broadcast as spread:auth-refused with the server's sentence", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResp({ code: "FORBIDDEN", reason: "UID_NOT_ALLOWED", error: "x@y.z is signed in but not allowed on this terminal" }, 403))));
    const { apiGet: get, AUTH_REFUSED_EVENT } = await import("../src/api/client");
    const got: string[] = [];
    window.addEventListener(AUTH_REFUSED_EVENT, (e) => got.push((e as CustomEvent<{ message: string }>).detail.message));
    await expect(get("/stocks")).rejects.toMatchObject({ status: 403, reason: "UID_NOT_ALLOWED" });
    expect(got).toEqual(["x@y.z is signed in but not allowed on this terminal"]);
  });

  it("with nobody signed in the request carries NO Authorization (the server names the refusal)", async () => {
    token = null;
    const fetchMock = vi.fn(() => Promise.resolve(jsonResp({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const { apiGet: get } = await import("../src/api/client");
    await get("/session");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("the socket's auth is a FUNCTION that presents the current token on every (re)connect", async () => {
    const { socketOptions } = await import("../src/api/client");
    const opts = socketOptions() as unknown as { auth: (cb: (d: Record<string, string>) => void) => void };
    expect(typeof opts.auth).toBe("function");
    const first = await new Promise<Record<string, string>>((r) => opts.auth(r));
    expect(first).toEqual({ token: "id-token-1" });
    token = "id-token-3";
    const second = await new Promise<Record<string, string>>((r) => opts.auth(r));
    expect(second).toEqual({ token: "id-token-3" });
  });
});
