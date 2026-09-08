import React, { useEffect, useState } from "react";
import { BookTile } from "./BookTile";
import { useLiveBooks } from "./useLiveBooks";
import { useSession } from "../api/hooks";
import type { StockCandidate, TradingContract } from "../api/types";
import { getBoard, getContracts } from "./api";

/**
 * ─── THE 20-MINUTE CLOCK ───────────────────────────────────────────────────
 *
 * A position that has not moved in 20 minutes closes at the bid. The rule
 * exists because waiting is where the losses come from — so the clock sits
 * ABOVE the ladders, not inside a tile. A clock you have to look for is a
 * clock you check after you needed it.
 */
const STOP_MINUTES = 20;

const Clock: React.FC<{ openedAt: string; symbol: string }> = ({ openedAt, symbol }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const held = (Date.now() - Date.parse(openedAt)) / 60000;
  const left = Math.max(0, STOP_MINUTES - held);
  const mm = Math.floor(left);
  const ss = Math.floor((left - mm) * 60);
  const state = held >= STOP_MINUTES ? "stop" : held >= 15 ? "warn" : "ok";

  return (
    <div className={`clock clock-${state}`}>
      <b>{symbol}</b> held {held.toFixed(0)}m
      <span className="clock-left">
        {state === "stop" ? "TIME STOP — close at the bid"
          : `${mm}:${String(ss).padStart(2, "0")} to the stop`}
      </span>
    </div>
  );
};

export const BooksView: React.FC = () => {
  const { slots, books, connected, error, reloadSlots } = useLiveBooks();
  // R-11 · the scraper's capture interval, from the server; tiles read stale from it.
  const captureIntervalSecs = useSession().data?.captureIntervalSecs;
  // One 5-second clock for the stale markers; a tile re-renders only when its
  // own book or this tick changes.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const [movers, setMovers] = useState<StockCandidate[]>([]);
  const [open, setOpen] = useState<TradingContract[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [boardLoaded, setBoardLoaded] = useState(false);

  useEffect(() => {
    // C-07 · typed, and a failure is SHOWN. `.catch(() => {})` made a 401 or a
    // 500 look like "nothing ranked yet".
    const load = () => {
      getBoard().then((b) => { setMovers(b); setLoadError(null); setBoardLoaded(true); }).catch((e) => setLoadError(e.message));
      getContracts().then((c) => setOpen(c)).catch((e) => setLoadError(e.message));
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const slotted = new Set(slots.map((s) => s.symbol));

  return (
    <div className="books-view">
      <div className="books-bar">
        <span className={connected ? "live-on" : "live-off"}>
          {connected ? "live" : "reconnecting…"}
        </span>
        <span className="book-dim">
          {slots.length} slot{slots.length === 1 ? "" : "s"} · the sweep re-reads
          the list each cycle, so a swap lands within 25s
        </span>
        {error && <span className="book-err">slots: {error}</span>}
        {loadError && <span className="book-err">board: {loadError}</span>}
      </div>

      {open
        // A position whose fill time is unknown gets no clock rather than a
        // NaN one. The fill time is the FILLED BUY leg's time.
        .filter((p) => p.state !== "picked")
        .map((p) => ({ p, at: p.legs.find((l) => l.side === "BUY" && (l.status === "FILLED" || l.status === "CARRIED"))?.time }))
        .filter((x) => !!x.at)
        .map(({ p, at }) => (
          <Clock key={`${p.symbol}-${p.seq}`} symbol={p.symbol} openedAt={at as string} />
        ))}

      <div className="books-grid">
        {slots.length === 0 && !error && <div className="book-dim">{connected ? "no depth slots configured — the scraper's /ingest/depth-symbols returned none" : "waiting for the slot list…"}</div>}
        {slots.map((s) => (
          <BookTile key={s.slot} slot={s} book={books[s.symbol]} onSwapped={reloadSlots} connected={connected} now={now} captureIntervalSecs={captureIntervalSecs} />
        ))}
      </div>

      {/*
        ─── IT RANKS, IT NEVER REMOVES ────────────────────────────────────────
        Every symbol that moved appears, with its failures NAMED rather than
        filtered out. And the five in the sweep are not necessarily the five
        worth watching: SHUAIBA and EMIRATES both got noticed only because
        someone went looking, so a mover with no book still appears — saying so.
      */}
      <div className="movers">
        <div className="movers-head">
          moved today · ranked, not filtered
        </div>
        {movers.length === 0 && !loadError && <div className="book-dim">{boardLoaded ? "board loaded — no symbol has moved into range yet" : "loading the board…"}</div>}
        {movers.slice(0, 20).map((m) => (
          <div key={m.symbol} className="mover">
            <span className="mover-sym">{m.symbol}</span>
            <span className="mover-why">
              {m.status === "recommended" ? (m.takeItBecause || "passes every gate")
                : m.notComputed?.length ? `NOT COMPUTED: ${m.notComputed.join(", ")}`
                : `${m.failingGateNames.join(" · ")}${m.rejectionDetail ? " — " + m.rejectionDetail : ""}`}
            </span>
            {!slotted.has(m.symbol) && (
              <span className="mover-nobook">no book — not in the depth list</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
