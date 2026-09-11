/**
 * src/live/api.ts — the live surfaces' reads and writes, all through /api.
 *
 * The scraper owns capture and the depth slots; the backend owns everything
 * computed — and, since D3, fronts the slots for the browser too, so the SPA
 * talks to ONE origin with ONE credential (the signed-in user's token).
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

import { apiGet, apiPost } from "../api/client";
import type { StockCandidate, TradingContract } from "../api/types";

/**
 * D3 · the depth slots go THROUGH THE BACKEND (GET/POST /api/slots), which
 * presents the scraper's token from its own env — the scraper's INGEST_TOKEN
 * used to be compiled into this bundle for these two calls. The backend relays
 * the scraper's status and body verbatim, so a refusal is still the scraper's
 * own sentence ("One symbol, one slot…") and ApiError carries it as `message`.
 */
export interface SlotList { symbols: Slot[]; trading_date: string; slotCount?: number }

/** The symbols currently swept, and how many slots there ARE (`slotCount` = the scraper's SLOT_COUNT). */
export const getSlots = (): Promise<SlotList> => apiGet<SlotList>("/slots");

/**
 * Swap a slot. Takes effect within 25 seconds — the sweep re-reads the list
 * every cycle, so no restart.
 *
 * Refuses when the slot holds an open position or a queued order; the refusal
 * names which, and that text is shown to the trader rather than a generic one.
 */
export const swapSlot = (slot: number, symbol: string, reason?: string) =>
  apiPost<{ ok: boolean; row?: unknown; error?: string }>(`/slots/${slot}`, { symbol, reason });

/** Today's board, ranked. The BACKEND's screening pipeline — typed (C-07). */
export const getBoard = (): Promise<StockCandidate[]> => apiGet<StockCandidate[]>("/stocks");

/** Open positions, for the 20-minute clock. A bare ARRAY, not {open|contracts}. */
export const getContracts = (): Promise<TradingContract[]> => apiGet<TradingContract[]>("/trading/contracts");
