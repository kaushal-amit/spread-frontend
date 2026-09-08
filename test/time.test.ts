/** 4.3 · every clock is Asia/Kuwait through Intl, whatever the host zone is. */
import { describe, it, expect } from "vitest";
import { kuwaitHHMM, kuwaitCalendarDate, ageSec, ageLabel, kuwaitHHMMSS } from "../src/lib/time";

describe("src/lib/time", () => {
  it("formats an instant on the Kuwait clock (UTC+3, no DST)", () => {
    expect(kuwaitHHMM("2026-09-03T06:00:00Z")).toBe("09:00");
    expect(kuwaitHHMMSS("2026-09-03T09:29:07Z")).toBe("12:29:07");
    expect(kuwaitHHMM("2026-01-15T06:00:00Z")).toBe("09:00"); // January: still +3
  });
  it("gives the Kuwait calendar date across the UTC midnight", () => {
    expect(kuwaitCalendarDate("2026-09-03T22:30:00Z")).toBe("2026-09-04");
    expect(kuwaitCalendarDate("2026-09-03T20:59:00Z")).toBe("2026-09-03");
  });
  it("is empty, not 'Invalid Date', for nothing", () => {
    expect(kuwaitHHMM(null)).toBe(""); expect(kuwaitHHMM("nonsense")).toBe("");
  });
  it("ages", () => {
    const now = Date.parse("2026-09-03T06:05:00Z");
    expect(ageSec("2026-09-03T06:04:30Z", now)).toBe(30);
    expect(ageSec(null, now)).toBeNull();
    expect(ageLabel(30)).toBe("30 s"); expect(ageLabel(200)).toBe("3 min"); expect(ageLabel(null)).toBe("unknown age");
  });
});
