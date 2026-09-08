/**
 * src/lib/time.ts — every clock on screen is Asia/Kuwait.
 *
 * The browser may be anywhere. `new Date().toTimeString()` is the browser's
 * wall clock and `toISOString().slice(0, 10)` is the UTC date — after 21:00
 * UTC that is tomorrow in Kuwait, and neither is the session's day. The
 * session day comes from the SERVER (`/api/session.kuwaitDay`, which rolls at
 * 04:00); this module only formats instants, always in Asia/Kuwait, through
 * Intl so the zone rule is the platform's, not an offset in our code.
 */
const ZONE = "Asia/Kuwait";

const hm = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const hms = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const long = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

const toDate = (v: string | number | Date | null | undefined): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "09:41" in Kuwait, or "" when there is no instant. */
export const kuwaitHHMM = (v: string | number | Date | null | undefined): string => {
  const d = toDate(v); return d ? hm.format(d) : "";
};
/** "09:41:07" in Kuwait. */
export const kuwaitHHMMSS = (v: string | number | Date | null | undefined): string => {
  const d = toDate(v); return d ? hms.format(d) : "";
};
/** The Kuwait CALENDAR date of an instant — not the session day (that rolls at 04:00 and comes from the server). */
export const kuwaitCalendarDate = (v: string | number | Date | null | undefined): string => {
  const d = toDate(v); return d ? ymd.format(d) : "";
};
/** "Thu 4 Sept, 09:41" in Kuwait. */
export const kuwaitLong = (v: string | number | Date | null | undefined): string => {
  const d = toDate(v); return d ? long.format(d) : "";
};
/** Whole seconds between now and an instant; null when unknown. */
export const ageSec = (v: string | number | Date | null | undefined, now: number = Date.now()): number | null => {
  const d = toDate(v); return d ? Math.max(0, Math.round((now - d.getTime()) / 1000)) : null;
};
/** "12 s", "4 min", "2 h" — for a stale-marker, never for arithmetic. */
export const ageLabel = (sec: number | null): string =>
  sec == null ? "unknown age" : sec < 60 ? `${sec} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`;
