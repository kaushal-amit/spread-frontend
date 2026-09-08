export const fmt = (n: number | null | undefined) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en-US"));
export const kd = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`);
import { kuwaitHHMM } from "../lib/time";
/** Kuwait clock, through Intl — not the browser's, not an offset. */
export const hhmm = (iso: string | null | undefined) => kuwaitHHMM(iso);
