// @vitest-environment jsdom
/**
 * D3 · AuthGate: nothing mounts before a signed-in user; a refusal is the
 * server's sentence with a sign-out, never an empty board.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let userCb: ((u: { uid: string; email: string | null } | null) => void) | null = null;
const signIn = vi.fn(async () => ({ uid: "u1", email: "amit@x" }));
const signOut = vi.fn(async () => {});
vi.mock("../src/auth", () => ({
  configured: true,
  onUser: (cb: typeof userCb) => { userCb = cb; return () => {}; },
  signIn: (...a: unknown[]) => signIn(...a as []),
  signOut: (...a: unknown[]) => signOut(...a as []),
  idToken: async () => null,
}));

import { AuthGate } from "../src/components/AuthGate";
import { AUTH_REFUSED_EVENT } from "../src/api/client";

let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); userCb = null; signIn.mockClear(); signOut.mockClear(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("AuthGate", () => {
  it("shows 'checking' until the SDK answers, then the sign-in screen — and mounts NOTHING behind it", () => {
    act(() => root.render(<AuthGate><div id="app">APP</div></AuthGate>));
    expect(host.querySelector("#auth-gate")?.getAttribute("data-state")).toBe("checking");
    expect(host.querySelector("#app")).toBeNull();
    act(() => userCb!(null));
    expect(host.querySelector("#auth-gate")?.getAttribute("data-state")).toBe("signed-out");
    expect(host.querySelector("#app")).toBeNull();
  });

  it("the button calls signIn, and a popup failure is shown as its sentence", async () => {
    signIn.mockRejectedValueOnce(new Error("popup closed by user"));
    act(() => root.render(<AuthGate><div id="app">APP</div></AuthGate>));
    act(() => userCb!(null));
    await act(async () => { (host.querySelector("#auth-signin") as HTMLButtonElement).click(); });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(host.querySelector("#auth-error")?.textContent).toMatch(/popup closed by user/);
    expect(host.querySelector("#app")).toBeNull();
  });

  it("a signed-in user mounts the app, with who-is-signed-in and a sign-out", () => {
    act(() => root.render(<AuthGate><div id="app">APP</div></AuthGate>));
    act(() => userCb!({ uid: "u1", email: "amit@x" }));
    expect(host.querySelector("#app")?.textContent).toBe("APP");
    expect(host.querySelector("#auth-who")?.textContent).toMatch(/amit@x/);
    act(() => { (host.querySelector("#auth-signout-small") as HTMLButtonElement).click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("a 403 UID_NOT_ALLOWED (broadcast by the client) replaces the app with the server's sentence and a sign-out", () => {
    act(() => root.render(<AuthGate><div id="app">APP</div></AuthGate>));
    act(() => userCb!({ uid: "u2", email: "x@y.z" }));
    expect(host.querySelector("#app")).not.toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(AUTH_REFUSED_EVENT, { detail: { message: "x@y.z is signed in but not allowed on this terminal", reason: "UID_NOT_ALLOWED" } })); });
    expect(host.querySelector("#auth-gate")?.getAttribute("data-state")).toBe("refused");
    expect(host.querySelector("#auth-refused")?.textContent).toBe("x@y.z is signed in but not allowed on this terminal");
    expect(host.querySelector("#app")).toBeNull();
    act(() => { (host.querySelector("#auth-signout") as HTMLButtonElement).click(); });
    expect(signOut).toHaveBeenCalledTimes(1);
    // signing out clears the refusal: back to the sign-in screen
    act(() => userCb!(null));
    expect(host.querySelector("#auth-gate")?.getAttribute("data-state")).toBe("signed-out");
  });
});
