/**
 * src/live/api.ts — the two origins, behind one proxy.
 *
 * The scraper owns capture and the depth slots; the backend owns everything
 * computed. Vite proxies both under /api and /ingest, so the browser sees a
 * single origin — no CORS on either service, and one less thing to unpick when
 * this sits behind a reverse proxy in production.
 */

export interface BookLevel { price: number; qty: number; orders: number | null; }
export interface Book {
  symbol: string;
  capturedAt: string | null;
  bids: BookLevel[];
  offers: BookLevel[];
  snapshots: number | null;
}
export interface Slot { slot: number; symbol: string; code: string | null; }

import { apiGet, INGEST_BASE, INGEST_TOKEN } from "../api/client";
import type { StockCandidate, TradingContract } from "../api/types";

/**
 * 4.6 · a failure body may not be JSON — a proxy's HTML 502, an empty 204, a
 * plain-text 401 from the scraper. Every case becomes one readable Error
 * carrying the status, never "Unexpected token < in JSON".
 */
const json = async (r: Response) => {
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!r.ok) {
    const plain = body ? (body.detail || body.error || body.message) : null;
    const snippet = !body && text ? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : null;
    // SPR-20 · when the server gives a readable sentence, show ONLY that — the
    // "409 Conflict — " prefix is noise to the trader ("One symbol, one slot…"
    // stands on its own). Fall back to the status line only when there is no
    // server message to show.
    if (plain) throw new Error(String(plain));
    throw new Error(`${r.status} ${r.statusText || ""}`.trim() + (snippet ? ` — ${snippet}` : ""));
  }
  // A 200 with a body that is NOT JSON is a misroute, not an empty book: the SPA
  // host answered /ingest with its index.html. Returning null here let a consumer
  // read `.symbols` off null ("Cannot read properties of null"). Surface it as a
  // diagnostic instead of a silent null. (A genuine empty 204 stays null.)
  if (body === null && text && text.trim()) {
    throw new Error("the scraper returned a non-JSON response — /ingest is not routed to the scraper (set VITE_INGEST_BASE)");
  }
  return body;
};
const scraperHeaders = (): Record<string, string> => (INGEST_TOKEN ? { Authorization: `Bearer ${INGEST_TOKEN}` } : {});

/**
 * The symbols currently swept, and how many slots there ARE. Served by the
 * SCRAPER — capture config. `slotCount` is the scraper's SLOT_COUNT (5 today,
 * G-5); the page draws that many chips, never a literal.
 */
export const getSlots = (): Promise<{ symbols: Slot[]; trading_date: string; slotCount?: number }> =>
  fetch(`${INGEST_BASE}/ingest/depth-symbols`, { headers: scraperHeaders() }).then(json);

/**
 * Swap a slot. Takes effect within 25 seconds — the sweep re-reads the list
 * every cycle, so no restart.
 *
 * Refuses when the slot holds an open position or a queued order; the refusal
 * names which, and that text is shown to the trader rather than a generic one.
 */
export const swapSlot = (slot: number, symbol: string, reason?: string) =>
  fetch(`${INGEST_BASE}/ingest/slots/${slot}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...scraperHeaders() },
    body: JSON.stringify({ symbol, reason }),
  }).then(json);

/** Today's board, ranked. The BACKEND's screening pipeline — typed (C-07). */
export const getBoard = (): Promise<StockCandidate[]> => apiGet<StockCandidate[]>("/stocks");

/** Open positions, for the 20-minute clock. A bare ARRAY, not {open|contracts}. */
export const getContracts = (): Promise<TradingContract[]> => apiGet<TradingContract[]>("/trading/contracts");
