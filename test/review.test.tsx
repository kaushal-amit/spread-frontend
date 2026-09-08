// @vitest-environment jsdom
/**
 * R-18 · review mode is read-only, and the picker refuses a date that did not trade.
 */
import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { StockDetail } from "../src/components/StockDetail";
import { isSelectableSession } from "../src/api/hooks";
import detail from "./fixtures/detail.json";
import type { Detail } from "../src/api/types";

describe("R-18 · the picker refuses a non-session date", () => {
  const sessions = ["2026-09-02", "2026-09-01", "2026-08-31"];
  it("accepts today and a day that traded", () => {
    expect(isSelectableSession("2026-09-04", "2026-09-04", sessions)).toBe(true);
    expect(isSelectableSession("2026-09-01", "2026-09-04", sessions)).toBe(true);
  });
  it("refuses a date not in /sessions (a holiday or a no-data day)", () => {
    expect(isSelectableSession("2026-08-29", "2026-09-04", sessions)).toBe(false);
  });
});

describe("R-18 · a past date renders the read-only state", () => {
  it("shows 'review — read only' and disables every write button", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const body = (detail as { body: Detail }).body;
    await act(async () => {
      root.render(
        <StockDetail symbol={body.symbol} detail={body} error={null} loading={false}
          detailAt={Date.now()} bookAt={Date.now()} connected stops={null} readOnly
          onChanged={() => {}} onFeed={() => {}} />,
      );
    });
    expect(host.textContent).toContain("review — read only");
    const buttons = [...host.querySelectorAll("button")];
    // Every trade button carries the disabled attribute in review mode.
    const trade = buttons.filter((b) => /POST BID|HIT|OFFER|BID FILLED|CANCEL|GO/i.test(b.textContent || ""));
    expect(trade.length).toBeGreaterThan(0);
    expect(trade.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => { root.unmount(); });
  });
});
