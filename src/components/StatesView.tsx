/**
 * StatesView — the reference catalogue of what the detail page can say.
 *
 * Static by nature: it documents the STATE MACHINE, not the market. The
 * states are the ones the backend's legs produce (WATCH, QUEUED BID, HOLDING,
 * QUEUED OFFER, DONE) plus the verdicts a card can carry. The old catalogue
 * listed prototype step numbers (−10…7) that no longer exist.
 */
import React from "react";

const STATES: [string, string, string, string][] = [
  ["WATCH", "no leg today", "the card's verdict: TRADABLE · NEAR MISS · NOT RECOMMENDED · REJECTED · OUT OF REACH · DEAD", "POST BID (price, KD)"],
  ["QUEUED BID", "a BUY leg is POSTED", "queue ahead, your %, fill estimate from /live/filltime", "BID FILLED (filled, executions) · CANCELLED"],
  ["HOLDING", "a FILLED buy with shares still held", "bid, unrealised, break-even, trail-arm; CARRIED when opened on a prior session", "POST OFFER (price, shares) · HIT THE BID"],
  ["QUEUED OFFER", "a SELL leg is POSTED against the open contract", "resting price and size; the ladder marks it", "OFFER FILLED · CANCEL OFFER · CANCEL + HIT BID"],
  ["DONE", "bought − sold = 0 on every contract today", "each closed contract: entry, exit, shares, net after fees", "—"],
];

const REFUSALS: [string, string][] = [
  ["a sell larger than the position", "409 REFUSED — the server knows what is held"],
  ["a second filled buy on a symbol with an open position", "409 REFUSED — one filled buy per contract"],
  ["a stale contract number", "409 REFUSED — the open contract is named in the reply"],
  ["hit-bid with the market closed", "409 REFUSED — no bid to hit"],
  ["a structural gate (price band) override", "409 — arithmetic, not judgement"],
  ["a bad date, symbol or budget", "400 with the reason, before anything touches the database"],
];

export const StatesView: React.FC = () => (
  <div className="today" id="states-panel">
    <p className="plan" style={{ marginBottom: 14 }}>
      The state is DERIVED from today's legs on the server; the page never keeps one. Every button is a write the
      backend validates, and a refusal is shown verbatim.
    </p>
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "11.5px", width: "100%" }}>
        <thead><tr>{["STATE", "WHEN", "WHAT THE PAGE SHOWS", "BUTTONS"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--line, #333)", color: "var(--dim)" }}>{h}</th>)}</tr></thead>
        <tbody>{STATES.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ padding: "6px 8px", borderBottom: "1px solid var(--line, #222)", fontWeight: i === 0 ? 700 : 400 }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <p className="plan" style={{ margin: "18px 0 8px" }}>What the server refuses</p>
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "11.5px", width: "100%" }}>
        <tbody>{REFUSALS.map((r) => <tr key={r[0]}><td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line, #222)" }}>{r[0]}</td><td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line, #222)", color: "var(--dim)" }}>{r[1]}</td></tr>)}</tbody>
      </table>
    </div>
  </div>
);
