import React, { useState } from "react";
import { Book, Slot, swapSlot } from "./api";
import { ageSec, ageLabel, kuwaitHHMMSS } from "../lib/time";

/** R-11 · stale = 3 × the scraper's capture interval (from the server, via /api/session),
 *  never a client constant that drifts from the scraper's actual sweep. */
const staleSecFrom = (captureIntervalSecs?: number) => 3 * (captureIntervalSecs && captureIntervalSecs > 0 ? captureIntervalSecs : 33);

/**
 * ─── LEVEL 1 IS A DIFFERENT ANSWER, NOT A SMALLER ONE ──────────────────────
 *
 * CATTL read at the touch on 2 September looked like a frozen book. Six levels
 * showed 3.9:1 buyers with a clear path to 185, and it went there inside the
 * minute. The tile therefore always renders the full ladder — there is no
 * collapsed mode, because the collapsed reading was wrong twice in two days.
 */

/**
 * A queue this size does not fill.
 *
 * Six orders on 2 September, one filled — and every failure was joining a
 * queue over 100,000. So the number at each level is shown, not just the
 * price, and anything above this is shaded.
 */
const WILL_NOT_FILL = 100_000;

const fmt = (n: number) => n.toLocaleString();

interface Props {
  slot: Slot;
  book: Book | undefined;
  onSwapped: () => void;
  levels?: number;
  /** socket state — a tile cannot be live without it */
  connected: boolean;
  /** a ticking clock from the parent, so staleness is re-evaluated without a push */
  now: number;
  /** R-11 · the scraper's capture interval, from the server; stale = 3 × it */
  captureIntervalSecs?: number;
}

/**
 * 4.4 · memoised: a `spread:book` for CATTL re-renders CATTL's tile only.
 * The parent keeps books in a map keyed by symbol and passes each tile its
 * own slice; with five tiles on screen, one push is one render.
 */
export const BookTile: React.FC<Props> = React.memo(function BookTile({ slot, book, onSwapped, levels = 8, connected, now, captureIntervalSecs }) {
  const [swapping, setSwapping] = useState(false);
  const [next, setNext] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const doSwap = async () => {
    const sym = next.trim().toUpperCase();
    if (!sym) return;
    try {
      setErr(null);
      await swapSlot(slot.slot, sym, "swapped from the book screen");
      setNext("");
      setSwapping(false);
      onSwapped();
    } catch (e: any) {
      // The refusal names WHICH — an open position or a queued order — and
      // that text is shown rather than a generic failure.
      setErr(e.message);
    }
  };

  const bids = (book?.bids || []).slice(0, levels);
  const offers = (book?.offers || []).slice(0, levels).reverse();

  const bidTotal = bids.reduce((t, l) => t + l.qty, 0);
  const offerTotal = offers.reduce((t, l) => t + l.qty, 0);
  const ratio = offerTotal > 0 ? bidTotal / offerTotal : null;
  const age = ageSec(book?.capturedAt ?? null, now);
  const stale = !!book && (!connected || age == null || age > staleSecFrom(captureIntervalSecs));

  return (
    <div className={`book-tile ${stale ? "stale" : ""}`} data-stale={stale ? "1" : undefined}>
      {stale && (
        <div className="book-stale" role="status">
          STALE — {!connected ? "not connected · " : ""}{book?.capturedAt ? `captured ${kuwaitHHMMSS(book.capturedAt)}, ${ageLabel(age)} ago` : "no capture time"}
        </div>
      )}
      <div className="book-head">
        <span className="book-sym">{slot.symbol}</span>
        <button
          className="book-slot"
          onClick={() => setSwapping((v) => !v)}
          title="swap this slot — live within 25 seconds"
        >
          slot {slot.slot} ▾
        </button>
      </div>

      {swapping && (
        <div className="book-swap">
          <input
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSwap()}
            placeholder="symbol"
            autoFocus
          />
          <button onClick={doSwap}>swap</button>
          {err && <div className="book-err">{err}</div>}
        </div>
      )}

      {!book || (!bids.length && !offers.length) ? (
        <div className="book-empty">
          no book captured yet
          <div className="book-dim">
            8 of 142 symbols hold a depth slot; the sweep runs every 25s
          </div>
        </div>
      ) : (
        <table className="book-ladder">
          <thead>
            <tr><th>offer</th><th>qty</th><th className="book-orders-h">orders</th></tr>
          </thead>
          <tbody>
            {offers.map((l, i) => (
              <tr key={`o${i}`} className={l.qty > WILL_NOT_FILL ? "book-thick" : ""}>
                <td className="book-ask">{l.price}</td>
                <td>{fmt(l.qty)}</td>
                {/*
                  A MISSING COLUMN, not a zero. bid_orders is the difference
                  between one wall and fifty participants, and the broker feed
                  does not carry it yet. When it arrives it changes readings,
                  not layouts.
                */}
                <td className="book-missing" title="order count not in the feed yet">—</td>
              </tr>
            ))}
            <tr className="book-mid">
              <td colSpan={3}>
                {ratio !== null ? `${ratio.toFixed(2)} bid per offer` : "—"}
                {book.snapshots ? ` · ${book.snapshots} snaps` : ""}
              </td>
            </tr>
            {bids.map((l, i) => (
              <tr key={`b${i}`} className={l.qty > WILL_NOT_FILL ? "book-thick" : ""}>
                <td className="book-bid">{l.price}</td>
                <td>{fmt(l.qty)}</td>
                <td className="book-missing" title="order count not in the feed yet">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
