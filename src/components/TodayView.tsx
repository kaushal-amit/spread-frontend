/**
 * TodayView — the board, from the backend, and nothing else.
 *
 * Every number here is a field the presenter emits (src/api/types.ts). No
 * gate is re-computed in the browser: the card shows the server's verdict and
 * the server's reason. What this page adds is ORDER and EMPHASIS.
 *
 * Three honest states, rendered differently on purpose:
 *   loading            — a fetch is in flight
 *   error              — the fetch failed; the code is shown, never an empty board
 *   NOT COMPUTED       — a gate failed for want of a number; shown per card
 *                        and summed at the top, because for weeks this was
 *                        indistinguishable from a quiet market
 */
import React from "react";
import type { StockCandidate, TradingContract, MarketDay, Budget } from "../api/types";
import type { Board, Live } from "../api/hooks";
import { fmt } from "../utils/format";
import { kuwaitHHMM, ageSec, ageLabel } from "../lib/time";

interface Props {
  board: Board | null;
  boardError: Error | null;
  boardLoading: boolean;
  connected: boolean;
  boardAt: number | null;
  market: Live<MarketDay>;
  budget: Live<Budget>;
  contracts: Live<TradingContract[]>;
  onPickSymbol: (symbol: string) => void;
}

const kd = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`);
/** 4.2 · a tile that has no data says so. "…" while loading, "n/a" after a failure — never a 0. */
const tile = <T,>(h: Live<T>, render: (d: T) => React.ReactNode): React.ReactNode =>
  h.data ? render(h.data) : h.loading ? "…" : "n/a";

// R-05 · the label and the colour come from the SERVER (regime text and the
// breadthBand it derives with the 35/50 thresholds); the browser re-derives
// neither. When the scraper has not classified the session, the band is null
// and the strip shows the number without a RISK label.
function regime(m: MarketDay | null) {
  if (!m || !m.available) return { label: "—", cls: "nu", pct: null as number | null };
  const cls = m.breadthBand === "risk_on" ? "up" : m.breadthBand === "risk_off" ? "dn" : "nu";
  const label = m.regime ? m.regime.replace(/_/g, " ") : "—";
  return { label, cls, pct: m.breadthPct };
}

export const TodayView: React.FC<Props> = ({ board, boardError, boardLoading, connected, boardAt, market: marketLive, budget: budgetLive, contracts: contractsLive, onPickSymbol }) => {
  const M = marketLive.data;
  const budget = budgetLive.data;
  const contracts = contractsLive.data;
  const R = regime(M);

  const open = (contracts || []).filter((c) => c.state !== "picked");
  const picked = (contracts || []).filter((c) => c.state === "picked");
  // The board is STALE when the socket is down or the last update is old.
  const boardAge = ageSec(boardAt);
  const boardStale = !!board && (!connected || (boardAge != null && boardAge > 120));
  const openSyms = new Set(open.map((c) => c.symbol));

  // SPR-39 · the change is stored as a float; round it to the tick on the card
  // the same way the review table does (SPR-10) — no ▼0.8999999999999986.
  const chgFil = (chg: number, price: number | null | undefined) =>
    Math.abs(chg).toFixed(price != null && Number(price) < 100 ? 1 : 0);

  const rec = board?.recommended ?? [];
  const near = board?.nearMiss ?? [];
  const rej = board?.rejected ?? [];
  const all = board?.all ?? [];
  const notComputed = all.filter((s) => s.notComputed?.length);
  // R-38 · the two causes come from the server (screening counts), not the browser.
  const noQuotes = board?.counts?.noQuotes ?? 0;
  const noStats = board?.counts?.noStats ?? 0;
  const bridged = all.filter((s) => s.gateStatsSource === "BACKEND_BRIDGE").length;

  // A5 · the m45 column — "2.4 · 09:45" from the 09:00–09:45 range-over-cost,
  // "—" before the job has run. A ranking hint, never a gate; the tooltip names
  // the coarse source (60 s quotes, all ~141 symbols).
  const m45Tag = (s: StockCandidate) => {
    const v = s.metrics.m45;
    const reason = s.metrics.m45Reason;
    return (
      <small className="m45" title="range-over-cost, first 45 min · from 60 s quotes">
        {" · m45 "}{v != null ? `${v} · 09:45` : reason ? reason.toLowerCase() : "—"}
      </small>
    );
  };

  const card = (s: StockCandidate, cls: "go" | "near" | "no") => {
    const why = cls === "go"
      ? s.takeItBecause || `net ${kd(s.netKd)} at ${s.metrics.targetTicks} tick${s.metrics.targetTicks === 1 ? "" : "s"}`
      : s.notComputed?.length
        ? `NOT COMPUTED: ${s.notComputed.join(", ")}`
        : `${s.failingGateNames.join(", ")}${s.rejectionDetail ? " · " + s.rejectionDetail : ""}`;
    return (
      <div key={`${s.symbol}-${cls}`} className={`pl ${cls === "near" ? "open" : cls} ${s.notComputed?.length ? "nc" : ""}`}
        id={`plan-card-${s.symbol}`} onClick={() => onPickSymbol(s.symbol)} title={s.careful || ""}>
        <span className="s">{s.symbol}{s.market && /premier/i.test(s.market) ? <sup title="Premier Market: 0.10%"> P</sup> : null}</span>
        <span className="p">{s.price}{s.changeFils ? <small className={s.changeFils > 0 ? "up" : "dn"}> {s.changeFils > 0 ? "▲" : "▼"}{chgFil(s.changeFils, s.price)}</small> : null}</span>
        <span className="w">{why}</span>
        {cls === "go" && <span className="rg">{fmt(s.shares)} sh · net {kd(s.netKd)}{m45Tag(s)}</span>}
        {cls !== "go" && s.behaviourFlags?.length ? <span className="rg">{s.behaviourFlags.map((b) => b.label).join(" · ")}{m45Tag(s)}</span> : null}
        {cls !== "go" && !s.behaviourFlags?.length && s.metrics.m45 != null ? <span className="rg">{m45Tag(s)}</span> : null}
      </div>
    );
  };

  // 4.6 · keyed by symbol + contract_seq. 4.2 · null is "no quote today", never 0.
  const positionCard = (c: TradingContract) => (
    <div key={`${c.symbol}-${c.seq}`} className="pl open" id={`plan-card-${c.symbol}`} onClick={() => onPickSymbol(c.symbol)}>
      <span className="s">{c.symbol}</span>
      <span className="p">{c.entry ?? "—"}</span>
      <span className="w">
        {c.state === "carried" ? "CARRIED" : "HOLDING"} · {fmt(c.shares)} @ {c.entry ?? "—"} · bid {c.bid == null ? "no quote today" : c.bid} ·{" "}
        {c.unrealisedKd == null ? "unrealised unknown" : `${kd(c.unrealisedKd)} KD`}
        {c.shares !== c.boughtShares ? ` · ${fmt(c.boughtShares - c.shares)} already sold` : ""}
      </span>
      <span className="rg">break-even {c.breakEvenPrice ?? "—"} · target {c.targetNormal ?? "—"}/{c.targetTrending ?? "—"}{c.peakSinceFill != null ? ` · peak ${c.peakSinceFill}` : ""}</span>
    </div>
  );

  return (
    <div className="today" id="today-panel">
      {/* ── market band: the scraper's market_day ── */}
      <div className="mband">
        {/* 4.2 · a market tile with no row says "no row"; loading says "…"; a failed fetch says "n/a". */}
        <div className="mb" id="mb-breadth"><span className="k">BREADTH</span>
          <span className={`v ${R.cls}`}>{tile(marketLive, (m) => (m.available ? `${m.breadthPct.toFixed(0)}%` : "no row"))}</span>
          <span className="x">{M?.available ? `${R.label}${!M.isToday ? " · prior session" : ""}` : M ? "no market_day for this session" : marketLive.error ? "market unavailable" : "loading"}</span></div>
        <div className="mb" id="mb-up"><span className="k">UP</span><span className="v up">{tile(marketLive, (m) => (m.available ? m.up : "—"))}</span><span className="x">advancing</span></div>
        <div className="mb" id="mb-down"><span className="k">DOWN</span><span className="v dn">{tile(marketLive, (m) => (m.available ? m.down : "—"))}</span><span className="x">declining</span></div>
        <div className="mb" id="mb-unchanged"><span className="k">UNCHANGED</span><span className="v nu">{tile(marketLive, (m) => (m.available ? m.flat : "—"))}</span><span className="x">no move</span></div>
        <div className="mb" id="mb-symbols"><span className="k">SYMBOLS</span><span className="v">{tile(marketLive, (m) => (m.available ? m.symbolsTraded : "—"))}</span>
          <span className="x">traded{board ? ` · ${all.length} screened` : ""}</span></div>
        <div className="mb" id="mb-volume"><span className="k">VOLUME</span><span className="v">{tile(marketLive, (m) => (m.available ? `${(m.volumeShares / 1e6).toFixed(1)}M` : "—"))}</span>
          <span className="x">{M?.available && M.volumeVs20d ? `${M.volumeVs20d.toFixed(2)}× 20d` : "shares"}</span></div>
        <div className="mb" id="mb-turnover"><span className="k">TURNOVER</span><span className="v">{tile(marketLive, (m) => (m.available ? `${(m.turnoverKd / 1e6).toFixed(1)}M` : "—"))}</span><span className="x">KD</span></div>
        <div className="mb" id="mb-trades"><span className="k">TRADES</span><span className="v">{tile(marketLive, (m) => (m.available ? m.trades.toLocaleString() : "—"))}</span><span className="x">prints</span></div>
        <div className="mb" id="mb-budget"><span className="k">FREE</span>
          <span className="v">{tile(budgetLive, (b) => fmt(Math.round(b.free_kd)))}</span>
          <span className="x">{budget ? `of ${fmt(budget.budget_kd)} · ${budget.reserve_held ? `${fmt(Math.round(budget.reserve_kd))} held to 11:00` : "reserve released"}` : budgetLive.error ? "budget unavailable" : "KD"}</span></div>
      </div>

      {M?.available && (
        <div className="bbar">
          <i className="u" style={{ flex: M.up }}></i><i className="d" style={{ flex: M.down }}></i><i className="f" style={{ flex: M.flat }}></i>
        </div>
      )}

      {/* ── R-19 / R-20 · the market gate and the session stops, loud and first ── */}
      {board?.stops && board.stops.mode !== 'trade' && board.stops.mode !== 'pre_open' && (
        <div className={`stopbar ${board.stops.canOpen ? 'careful' : 'stopped'}`} id="session-stops" role="alert">
          <b>{board.stops.mode === 'careful' ? 'CAREFUL — one position, take 2 fils'
            : board.stops.mode === 'cooloff' ? 'NO RE-ENTRY — 30 minutes after a loss'
            : board.stops.mode === 'stop' ? 'STOP — no new position'
            : 'MARKET GATE NOT COMPUTED'}</b>
          {board.stops.reasons.length > 0 && <span className="stopwhy"> {board.stops.reasons.join(' · ')}</span>}
          {(() => {
            const rd = board.stops.market?.readings;
            const seen = rd ? ['0900', '0930', '1000'].map((k) => rd[k]).filter(Boolean).map((r) => `${r!.clock} ${r!.breadthPct}%`) : [];
            return seen.length ? <span className="stopread"> · breadth {seen.join(' → ')}</span> : null;
          })()}
        </div>
      )}

      {/* ── state line: loud, not plausible ── */}
      <p className="plan" id="board-state">
        {boardError ? <b className="dn">BOARD UNAVAILABLE — {(boardError as any).code || "error"}: {boardError.message}</b>
          : boardLoading && !board ? "Loading the board…"
          : board ? <>
              {board.tradingDay ? `Session ${board.tradingDay}` : "Board"} · {all.length} symbols · <b>{rec.length}</b> recommended · <b>{near.length}</b> one gate away · {rej.length} rejected{notComputed.length ? ` · ${notComputed.length} not computed` : ""}
              {board.budgetKd ? ` · slot ${fmt(board.budgetKd)} KD` : ""}
              {boardStale
                ? <b className="dn"> · STALE — {connected ? `last update ${ageLabel(boardAge)} ago` : "not connected"}{boardAt ? ` (${kuwaitHHMM(boardAt)} Kuwait)` : ""}</b>
                : connected ? " · live" : " · not connected — showing the last fetch"}
            </> : null}
      </p>
      {contractsLive.error && !contracts && (
        <p className="plan warn" id="contracts-unavailable"><b>Positions unavailable</b> — {(contractsLive.error as any).code || "error"}: {contractsLive.error.message}. Nothing below can be trusted to be flat.</p>
      )}
      {board && (notComputed.length > 0 || noQuotes > 0 || noStats > 0) && (
        <p className="plan warn" id="board-not-computed">
          <b>Statistics missing for {notComputed.length} symbol{notComputed.length === 1 ? "" : "s"}</b>
          {noQuotes ? ` — ${noQuotes} with no quotes for this day` : ""}
          {noStats ? `${noQuotes ? ";" : " —"} ${noStats} with quotes but stats:daily has not run` : ""}.
          {bridged ? ` ${bridged} read the backend bridge.` : ""} A gate without a number is shown as NOT COMPUTED, never as a failed stock.
        </p>
      )}

      {/* ── sections ── */}
      {(open.length > 0 || picked.length > 0) && (
        <div className="plgrp">
          <span className="plk">OPEN NOW</span>
          {open.map(positionCard)}
          {picked.map((c) => (
            <div key={`pick-${c.symbol}`} className="pl open" onClick={() => onPickSymbol(c.symbol)}>
              <span className="s">{c.symbol}</span><span className="p">—</span>
              <span className="w">CLAIMED · {fmt(c.committedKd)} KD reserved, no fill yet</span>
            </div>
          ))}
        </div>
      )}

      <div className="plgrp">
        <span className="plk">WORTH TAKING</span>
        {rec.filter((s) => !openSyms.has(s.symbol)).length
          ? rec.filter((s) => !openSyms.has(s.symbol)).map((s) => card(s, "go"))
          : <div className="pl none">{board ? "Nothing on the board passes every gate right now." : "—"}</div>}
      </div>

      {near.length > 0 && (
        <div className="plgrp">
          <span className="plk">ONE GATE AWAY</span>
          {near.slice(0, 12).map((s) => card(s, "near"))}
          {near.length > 12 && <div className="pl none">and {near.length - 12} more</div>}
        </div>
      )}

      {rej.length > 0 && (
        <div className="plgrp">
          <span className="plk">LEAVE ALONE · {rej.length}</span>
          {rej.slice(0, 6).map((s) => card(s, "no"))}
          {rej.length > 6 && <div className="pl none">and {rej.length - 6} more — sorted by what they would have paid</div>}
        </div>
      )}

      {/* SPR-38 · the third bucket. These are not rejected — a gate could not be
          computed for want of a number. Shown apart so the board never reads
          "140 rejected" over cards that never failed a stock. */}
      {notComputed.length > 0 && (
        <div className="plgrp">
          <span className="plk">NOT COMPUTED · {notComputed.length}</span>
          {notComputed.slice(0, 6).map((s) => card(s, "no"))}
          {notComputed.length > 6 && <div className="pl none">and {notComputed.length - 6} more — a statistic is missing, not a failed stock</div>}
        </div>
      )}

      {board && Object.keys(board.counts).length > 0 && (
        <p className="plan" style={{ marginTop: 16 }} id="board-gate-counts">
          Failures by gate:{" "}
          {Object.entries(board.counts)
            .filter(([k]) => !["all", "recommended", "nearMiss", "rejected", "notComputed", "noQuotes", "noStats"].includes(k))
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
      )}
    </div>
  );
};
