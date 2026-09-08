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

import { apiGet, API_TOKEN } from "../api/client";
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
    throw new Error(`${r.status} ${r.statusText || ""}`.trim() + (plain ? ` — ${plain}` : snippet ? ` — ${snippet}` : ""));
  }
  return body;
};
const scraperHeaders = (): Record<string, string> => (API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {});

/** The five symbols currently swept. Served by the SCRAPER — capture config. */
export const getSlots = (): Promise<{ symbols: Slot[]; trading_date: string }> =>
  fetch("/ingest/depth-symbols", { headers: scraperHeaders() }).then(json);

/**
 * Swap a slot. Takes effect within 25 seconds — the sweep re-reads the list
 * every cycle, so no restart.
 *
 * Refuses when the slot holds an open position or a queued order; the refusal
 * names which, and that text is shown to the trader rather than a generic one.
 */
export const swapSlot = (slot: number, symbol: string, reason?: string) =>
  fetch(`/ingest/slots/${slot}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...scraperHeaders() },
    body: JSON.stringify({ symbol, reason }),
  }).then(json);

/** Today's board, ranked. The BACKEND's screening pipeline — typed (C-07). */
export const getBoard = (): Promise<StockCandidate[]> => apiGet<StockCandidate[]>("/stocks");

/** Open positions, for the 20-minute clock. A bare ARRAY, not {open|contracts}. */
export const getContracts = (): Promise<TradingContract[]> => apiGet<TradingContract[]>("/trading/contracts");
