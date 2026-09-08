/** 4.1 · a thrown render error becomes a panel with the error and a reload button — never a white screen. */
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

function Thrower({ boom }: { boom: boolean }) {
  if (boom) throw new Error("card exploded: bid is null");
  return <div id="fine">fine</div>;
}

describe("ErrorBoundary", () => {
  it("renders the error and a reload button instead of nothing", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const quiet = console.error; console.error = () => {};
    await act(async () => { root.render(<ErrorBoundary name="TODAY"><Thrower boom /></ErrorBoundary>); });
    console.error = quiet;
    expect(host.textContent).toContain("RENDER FAILED");
    expect(host.textContent).toContain("card exploded: bid is null");
    expect(host.querySelector("button")?.textContent).toMatch(/RELOAD/);
    expect(host.textContent?.trim().length).toBeGreaterThan(0);
  });
  it("renders children when nothing throws", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => { root.render(<ErrorBoundary name="TODAY"><Thrower boom={false} /></ErrorBoundary>); });
    expect(host.querySelector("#fine")).not.toBeNull();
  });
});
