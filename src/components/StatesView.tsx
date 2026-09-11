/**
 * StatesView — the catalogue of every state the detail page can be in.
 *
 * F9 · Three tables, like the reference's catalogue but from OUR state
 * machine: the CONTRACT states the legs produce (WATCH … DONE, PART FILLED,
 * STOP HIT, TIME STOP, CARRIED), the CARD verdicts (the CR-8 buckets), and
 * the SESSION gates (pre-open, the stops modes, flat-by, Trading at Last,
 * closed). Each contract row has a SEE cell: a symbol currently in that
 * state, from the live contracts and the board — or "none today". The state
 * is DERIVED on the server; the page never keeps one.
 */
import React from "react";
import type { TradingContract, SessionInfo, SessionStops } from "../api/types";
import type { Board } from "../api/hooks";

interface Props {
  contracts: TradingContract[] | null;
  board: Board | null;
  session: SessionInfo | null;
  stops: SessionStops | null;
  onPickSymbol: (symbol: string) => void;
}

type Row = { state: string; when: string; shows: string; buttons: string; see: string[] };

/** The contract states, each with the symbols currently in it. */
function contractRows(contracts: TradingContract[] | null, board: Board | null, stops: SessionStops | null): Row[] {
  const open = (contracts || []).filter((c) => c.state !== "picked");
  const has = (pred: (c: TradingContract) => boolean) => open.filter(pred).map((c) => c.symbol);
  const legRest = (c: TradingContract, side: "BUY" | "SELL") => c.legs.some((l) => l.side === side && (l.status === "POSTED" || (l.status === "FILLED" && l.restStatus === "POSTED")));
  // WATCH's example: the board's first TAKE card with no position (else any card).
  const watching = [...(board?.take || []), ...(board?.all || [])].filter((s) => !open.some((c) => c.symbol === s.symbol)).map((s) => s.symbol);
  return [
    { state: "WATCH", when: "no leg today", shows: "the card's verdict (TAKE · ONE AWAY · PRICE WARN · LEAVE · NOT COMPUTED), the band, where the stop would sit", buttons: "POST BID (price, KD) · TAKE IT ANYWAY (reason) when the card is not TAKE or the size is outside the band", see: watching.slice(0, 1) },
    // A POSTED buy with no fill is not a contract yet, so /trading/contracts
    // cannot name one — the detail page shows it; this row has no SEE.
    { state: "QUEUED BID", when: "a BUY leg is POSTED", shows: "queue ahead, your %, fill estimate", buttons: "BID FILLED (filled, executions) · CANCELLED", see: [] },
    { state: "PART FILLED", when: "the buy filled in part; its rest is still queued on the same leg", shows: "filled of posted, the rest resting, the mark, the stop — two fills cost two commissions", buttons: "REST FILLED (rest filled, executions) · CANCEL THE REST — the close waits until the rest is resolved", see: has((c) => (c.restingBuyShares ?? 0) > 0 && !legRest(c, "SELL")) },
    { state: "HOLDING", when: "a FILLED buy with shares still held", shows: "MARK · BID PROTECTED · EXIT AT · VOLUME · CEILING · REFILL · EXIT OK, the recorded stop", buttons: "POST OFFER (price, shares) · HIT THE BID", see: has((c) => c.state === "holding" && !(c.restingBuyShares ?? 0) && !legRest(c, "SELL") && !c.stopHitAt) },
    { state: "CARRIED", when: "the position was opened on a prior session", shows: "as HOLDING, marked CARRIED", buttons: "as HOLDING", see: has((c) => c.state === "carried") },
    { state: "QUEUED OFFER", when: "a SELL leg is POSTED, or the rest of a partial sell is queued", shows: "resting price and size; the ladder marks it", buttons: "OFFER FILLED · CANCEL OFFER · CANCEL + HIT BID (REST FILLED · CANCEL THE REST for a queued rest)", see: has((c) => legRest(c, "SELL")) },
    { state: "STOP HIT", when: "the bid printed at or through the stop recorded at the fill", shows: "STOP HIT in red, the mark, the stop; the ladder marks the row", buttons: "HIT THE BID leads · the offer stays second", see: has((c) => !!c.stopHitAt) },
    { state: "TIME STOP", when: "held past the time-stop clock with no favourable print", shows: "TIME STOP with the minutes held; the alert fired once", buttons: "HIT THE BID", see: (stops?.timeStops || []).map((t) => t.symbol) },
    { state: "DONE", when: "bought − sold = 0 on every contract today", shows: "each closed contract: bought, sold, net after fees; the day", buttons: "—", see: [] },
  ];
}

const CARD_ROWS: [string, string, string][] = [
  ["TAKE", "every gate passed at this budget", "POST BID"],
  ["ONE AWAY", "one gate failed", "TAKE IT ANYWAY, with a reason — recorded as an override"],
  ["PRICE WARN", "the price ceiling is the only failing fact — the fils it needs at this budget", "TAKE IT ANYWAY, with a reason"],
  ["LEAVE", "more than one gate failed", "TAKE IT ANYWAY, with a reason"],
  ["LEAVE · structural", "out of reach, below the tick, target infeasible, suspended — folded", "none: arithmetic, not judgement"],
  ["NOT COMPUTED", "a gate has no number (no quote, stats:daily not run)", "TAKE IT ANYWAY, with a reason — a verdict not read is not permission"],
];

function sessionRows(session: SessionInfo | null, stops: SessionStops | null): [string, string, string, boolean][] {
  const phase = session?.phase ?? null;
  const mode = stops?.mode ?? null;
  return [
    ["PRE-OPEN", "before 09:00 — set a limit in the lower half of the crossed range; in a thin auction the highest bid sets the price", "no writes", phase === "pre_open"],
    ["TRADE", "the market gate is open and no stop is in force", "every button", mode === "trade"],
    ["CAREFUL", "breadth is weak — one position only", "POST BID once", mode === "careful"],
    ["COOL-OFF", "a loss closed — no re-entry for the cool-off window", "closes only", mode === "cooloff"],
    ["STOP", "the session stops: breadth, losses, or past the flat-by clock", "closes only", mode === "stop"],
    ["BE FLAT", "past the flat-by clock — you should be flat; a hit-bid into the closing auction is refused", "closes refused until Trading at Last", !!stops?.pastFlatBy && phase !== "tal" && phase !== "closed"],
    ["TRADING AT LAST", "13:10–13:14 (the exchange's TAL label) — trades at the closing-auction price only", "CLOSE AT AUCTION PRICE · CANCEL + CLOSE AT AUCTION", phase === "tal"],
    ["CLOSED", "the session is over, or a weekend", "nothing — the graded board arrives after stats:daily", phase === "closed" || mode === "closed"],
  ];
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--line, #333)", color: "var(--dim)", fontSize: "9.5px", letterSpacing: ".1em" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--line, #222)", verticalAlign: "top" };

export const StatesView: React.FC<Props> = ({ contracts, board, session, stops, onPickSymbol }) => {
  const rows = contractRows(contracts, board, stops);
  return (
    <div className="today" id="states-panel">
      <p className="plan" style={{ marginBottom: 14 }}>
        Every state the detail page can be in. The state is DERIVED from today's legs on the server; the page never keeps one.
        Every button is a write the backend validates, and a refusal is shown verbatim. <b>SEE</b> is a symbol in that state now.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "11.5px", width: "100%" }} id="states-contract">
          <thead><tr>{["STATE", "FIRES WHEN", "WHAT THE PAGE SHOWS", "BUTTONS", "SEE"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.state} data-state={r.state}>
              <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{r.state}</td>
              <td style={{ ...td, color: "var(--dim)" }}>{r.when}</td>
              <td style={td}>{r.shows}</td>
              <td style={{ ...td, color: "var(--dim)" }}>{r.buttons}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>
                {r.see.length
                  ? r.see.slice(0, 3).map((s) => <span key={s} className="slot" id={`see-${r.state.replace(/\s+/g, "-")}-${s}`} style={{ padding: "2px 8px", fontSize: "10.5px", marginRight: 4 }} onClick={() => onPickSymbol(s)}>{s}</span>)
                  : <span className="hint">{contracts === null && r.state !== "WATCH" ? "positions not loaded" : "none today"}</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <p className="plan" style={{ margin: "18px 0 8px" }}>The card's verdict (CR-8 · nothing removed, every instrument in exactly one bucket)</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "11.5px", width: "100%" }} id="states-card">
          <thead><tr>{["BUCKET", "WHEN", "POST BID READS"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{CARD_ROWS.map((r) => <tr key={r[0]}><td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{r[0]}</td><td style={{ ...td, color: "var(--dim)" }}>{r[1]}</td><td style={td}>{r[2]}</td></tr>)}</tbody>
        </table>
      </div>

      <p className="plan" style={{ margin: "18px 0 8px" }}>The session (the server's clock and the stops — the row that is <b>now</b> is marked)</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "11.5px", width: "100%" }} id="states-session">
          <thead><tr>{["MODE", "WHEN", "WRITES", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>{sessionRows(session, stops).map((r) => (
            <tr key={r[0]} data-now={r[3] ? "1" : undefined}>
              <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{r[0]}</td>
              <td style={{ ...td, color: "var(--dim)" }}>{r[1]}</td>
              <td style={td}>{r[2]}</td>
              <td style={td}>{r[3] ? <b className="up">now</b> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <p className="plan" style={{ margin: "18px 0 8px" }}>What the server refuses</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "11.5px", width: "100%" }} id="states-refusals">
          <tbody>{REFUSALS.map((r) => <tr key={r[0]}><td style={td}>{r[0]}</td><td style={{ ...td, color: "var(--dim)" }}>{r[1]}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
};

const REFUSALS: [string, string][] = [
  ["a sell larger than the position", "409 REFUSED — the server knows what is held"],
  ["a second buy on a symbol with an open position", "409 REFUSED — one open position per symbol; a partial's rest fills into its own leg"],
  ["a post outside the sizing band", "409 OUTSIDE_SIZE_BAND — TAKE IT ANYWAY with a reason, recorded as an override"],
  ["a post on a card that is not TAKE", "409 NOT_TAKE — TAKE IT ANYWAY with a reason; a structural card is plain REFUSED, no override"],
  ["a post while the board is not computed", "409 BOARD_NOT_COMPUTED — a verdict not read is not permission"],
  ["a stale contract number", "409 REFUSED — the open contract is named in the reply"],
  ["hit-bid with the market closed, or past the flat-by clock outside Trading at Last", "409 REFUSED — no bid to hit, or not into the auction"],
  ["resolving the rest of a whole fill", "409 REFUSED — nothing is resting"],
  ["a bad date, symbol, budget or a missing override reason", "400 with the reason, before anything touches the database"],
];
