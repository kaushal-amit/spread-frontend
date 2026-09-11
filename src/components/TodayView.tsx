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
import React, { useState } from "react";
import type { StockCandidate, TradingContract, MarketDay, Budget } from "../api/types";
import type { Board, Live } from "../api/hooks";
import { fmt } from "../utils/format";
import { kuwaitHHMM, ageSec, ageLabel } from "../lib/time";
import { BOARD_STALE_MS } from "../config/endpoints";
import { SCREENER_FILTERS, screenerLabel, applyScreener, screenerColumns, type ScreenerKey } from "../lib/screener";

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

  // C1 · the seven screener filters. Pure client-side predicates over fields the
  // payload already carries; ALL is the default and leaves the board untouched.
  const [filter, setFilter] = React.useState<ScreenerKey>("ALL");

  const open = (contracts || []).filter((c) => c.state !== "picked");
  const picked = (contracts || []).filter((c) => c.state === "picked");
  // The board is STALE when the socket is down or the last update is old.
  const boardAge = ageSec(boardAt);
  const boardStale = !!board && (!connected || (boardAge != null && boardAge > BOARD_STALE_MS / 1000));
  const openSyms = new Set(open.map((c) => c.symbol));

  // SPR-39 · the change is stored as a float; round it to the tick on the card
  // the same way the review table does (SPR-10) — no ▼0.8999999999999986.
  const chgFil = (chg: number, price: number | null | undefined) =>
    Math.abs(chg).toFixed(price != null && Number(price) < 100 ? 1 : 0);

  // CR-8 · the four verdict buckets from the server (screening.js bucketize):
  // TAKE / ONE AWAY / PRICE WARN / LEAVE, plus NOT COMPUTED below. Nothing is
  // removed: `all` is their concatenation and equals counts.universe.
  const rec = board?.take ?? [];
  const near = board?.oneAway ?? [];
  const priceWarn = board?.priceWarn ?? [];
  const rej = board?.leave ?? [];
  const all = board?.all ?? [];
  // SPR-38 · the NOT COMPUTED bucket is the SERVER's (cards that fail only on
  // uncomputed gates). Deriving it from `all` put every rejected card with one
  // uncomputed gate in BOTH lists (live: 112 rejected + 140 not computed for
  // 140 symbols) and hid the gate that really failed behind "NOT COMPUTED: …".
  const notComputed = board?.notComputed ?? [];
  // C1 · apply the active screener predicate to each bucket for RENDERING. The
  // top state line keeps the true totals; the sections below show the filtered
  // slices so ALL is the board unchanged and any other chip narrows it.
  const recF = applyScreener(rec, filter);
  const nearF = applyScreener(near, filter);
  const pwF = applyScreener(priceWarn, filter);
  const rejF = applyScreener(rej, filter);
  const ncF = applyScreener(notComputed, filter);
  // CR-8 · the LEAVE fold: structural rows (out of reach, below tick, infeasible
  // target, suspended) are FOLDED at the foot of LEAVE with their counts —
  // folded, never filtered. The trader can open the fold; they cannot be shown
  // a stock that was never there.
  const rejOpen = rejF.filter((s) => !s.structuralReason);
  const rejFolded = rejF.filter((s) => !!s.structuralReason);
  const [foldOpen, setFoldOpen] = useState(false);
  const foldCounts = (["OUT_OF_REACH", "BELOW_TICK", "INFEASIBLE_TARGET", "SUSPENDED"] as const)
    .map((r) => [r, rejFolded.filter((s) => s.structuralReason === r).length] as const)
    .filter(([, n]) => n > 0);
  const FOLD_LABEL: Record<string, string> = { OUT_OF_REACH: `out of reach at ${board?.budgetKd ? fmt(board.budgetKd) : "this"} KD`, BELOW_TICK: "below the 100-fil tick", INFEASIBLE_TARGET: "target infeasible", SUSPENDED: "suspended" };
  const filterActive = filter !== "ALL";
  const matched = filterActive ? applyScreener(all, filter).length : all.length;
  // R-38 · the two causes come from the server (screening counts), not the browser.
  const noQuotes = board?.counts?.noQuotes ?? 0;
  const noStats = board?.counts?.noStats ?? 0;
  // §0 · EMPTY IS NOT BROKEN — and a board with no symbols AND no counts is
  // broken, not empty: a computed board always carries its counts. Without
  // this a failed screen read "0 symbols · live · nothing passes every gate".
  const boardBroken = !!board && !boardError && all.length === 0 && Object.keys(board.counts ?? {}).length === 0;
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
    // A rejected card names the gates that MEASURED a failure; the uncomputed
    // ones follow, marked, so "NOT COMPUTED: …" never hides a real reject.
    const nc = new Set(s.notComputed ?? []);
    const realFails = s.failingGateNames.filter((g) => !nc.has(g));
    const why = cls === "go"
      ? s.takeItBecause || `net ${kd(s.netKd)} at ${s.metrics.targetTicks} tick${s.metrics.targetTicks === 1 ? "" : "s"}`
      // CR-8 · PRICE WARN is an economics line, not a stock verdict: the fils
      // this price needs at this budget (CR-2), or that no move under 12 does.
      : s.bucket === "PRICE_WARN"
        ? `price ${s.price ?? "—"} — ${s.needsFils != null ? `needs ${s.needsFils} fil${s.needsFils === 1 ? "" : "s"} at ${board?.budgetKd ? fmt(board.budgetKd) : "this"} KD` : "no move under 12 fils nets the floor at this budget"}`
      // The ABAR line: no row for the day, and when the last one was.
      : s.noRow
        ? s.rejectionDetail || `no symbol_day row for this day${s.lastRowDay ? ` — last row ${s.lastRowDay}` : ""}`
      : s.status === "not_computed" || (!realFails.length && nc.size)
        ? `NOT COMPUTED: ${[...nc].join(", ")}`
        : `${realFails.join(", ")}${nc.size ? ` · not computed: ${[...nc].join(", ")}` : ""}${s.rejectionDetail ? " · " + s.rejectionDetail : ""}`;
    // CR-7 · every gate's "value vs threshold — PASS/FAIL" line, on the card's tooltip.
    const checks = s.gateGroups?.flatMap((g) => g.cells).filter((c) => c.check?.text).map((c) => `${c.label}: ${c.check!.text}`).join("\n") ?? "";
    return (
      <div key={`${s.symbol}-${cls}`} className={`pl ${cls === "near" ? "open" : cls} ${s.notComputed?.length ? "nc" : ""} ${s.structuralReason ? "structural" : ""} ${s.bucket === "PRICE_WARN" ? "pw" : ""}`}
        data-bucket={s.bucket} data-structural={s.structuralReason || undefined}
        id={`plan-card-${s.symbol}`} onClick={() => onPickSymbol(s.symbol)} title={[s.careful || "", checks].filter(Boolean).join("\n")}>
        <span className="s">{s.symbol}{s.market && /premier/i.test(s.market) ? <sup title="Premier Market: 0.10%"> P</sup> : null}</span>
        <span className="p">{s.price ?? "—"}{s.changeFils ? <small className={s.changeFils > 0 ? "up" : "dn"}> {s.changeFils > 0 ? "▲" : "▼"}{chgFil(s.changeFils, s.price)}</small> : null}</span>
        <span className="w">{why}</span>
        {cls === "go" && <span className="rg">{fmt(s.shares)} sh · net {kd(s.netKd)}{m45Tag(s)}</span>}
        {cls !== "go" && s.behaviourFlags?.length ? <span className="rg">{s.behaviourFlags.map((b) => b.label).join(" · ")}{m45Tag(s)}</span> : null}
        {cls !== "go" && !s.behaviourFlags?.length && s.metrics.m45 != null ? <span className="rg">{m45Tag(s)}</span> : null}
        {/* C2 · the screener row's columns, from metrics/headroom already on the
            candidate — price, tick, 1d, tiny, mv, up2, vol×, post%, exit%,
            net/fil, reach×. Nothing re-derived; the server decided each. */}
        <span className="mx">
          {screenerColumns(s).map((col) => (
            <em key={col.k} className="mxc"><i>{col.k}</i> {col.v}</em>
          ))}
        </span>
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

      {/* SPR-40 · the session mode is shown ONCE, by the always-mounted
          SessionBanner (SPR-04/05) — one state, one label, on every tab. The
          TodayView stopbar that used to duplicate it here (with a different
          wording, "STOP — no new position") is gone. */}

      {/* ── state line: loud, not plausible ── */}
      <p className="plan" id="board-state">
        {boardError ? <b className="dn">BOARD UNAVAILABLE — {(boardError as any).code || "error"}: {boardError.message}</b>
          : boardBroken ? <b className="dn">BOARD BROKEN — the server returned no symbols and no counts. Not a quiet market: check the backend.</b>
          : boardLoading && !board ? "Loading the board…"
          : board ? <>
              {board.tradingDay ? `Session ${board.tradingDay}` : "Board"} · {all.length} symbols · <b>{rec.length}</b> take · <b>{near.length}</b> one away · {priceWarn.length} price warn · {rej.length} leave{notComputed.length ? ` · ${notComputed.length} not computed` : ""}
              {board.budgetKd ? ` · slot ${fmt(board.budgetKd)} KD` : ""}
              {board.stops?.mode === "closed"
                ? <b> · market closed</b>
                : boardStale
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

      {/* C1 · the seven screener filters — pure client-side predicates over the
          fields the payload already carries. ALL leaves the board untouched. */}
      {board && (
        <div className="scrn" id="screener-filters" role="group" aria-label="screener filters">
          {SCREENER_FILTERS.map((def) => (
            <button key={def.key} type="button" id={`screener-${def.key}`}
              className={`chip ${filter === def.key ? "on" : ""}`}
              aria-pressed={filter === def.key}
              onClick={() => setFilter(def.key)}>
              {screenerLabel(def, board.budgetKd)}
            </button>
          ))}
          {filterActive && <span className="scrn-n">{matched} of {all.length}</span>}
        </div>
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
        <span className="plk">WORTH TAKING{filterActive ? ` · ${screenerLabel(SCREENER_FILTERS.find((f) => f.key === filter)!, board?.budgetKd ?? null)}` : ""}</span>
        {recF.filter((s) => !openSyms.has(s.symbol)).length
          ? recF.filter((s) => !openSyms.has(s.symbol)).map((s) => card(s, "go"))
          : <div className="pl none">{boardError ? "board unavailable — nothing was evaluated" : boardBroken ? "no symbols came back and no counts — this is a broken board, not a quiet one" : board ? (filterActive ? "None of the recommended pass this filter." : "Nothing on the board passes every gate right now.") : "—"}</div>}
      </div>

      {nearF.length > 0 && (
        <div className="plgrp" id="section-one-away">
          <span className="plk">ONE AWAY</span>
          {nearF.slice(0, 12).map((s) => card(s, "near"))}
          {nearF.length > 12 && <div className="pl none">and {nearF.length - 12} more</div>}
        </div>
      )}

      {/* CR-8 · PRICE WARN — the price ceiling is the only failing fact. An
          economics warning ("needs 3 fils at 2,000 KD"), not a stock verdict;
          overridable, and it used to hide inside ONE AWAY / LEAVE unmarked. */}
      {pwF.length > 0 && (
        <div className="plgrp" id="section-price-warn">
          <span className="plk">PRICE WARN · {pwF.length}</span>
          {pwF.slice(0, 8).map((s) => card(s, "near"))}
          {pwF.length > 8 && <div className="pl none">and {pwF.length - 8} more — above the ceiling for this budget</div>}
        </div>
      )}

      {rejF.length > 0 && (
        <div className="plgrp" id="section-leave">
          <span className="plk">LEAVE · {rejF.length}</span>
          {rejOpen.slice(0, 6).map((s) => card(s, "no"))}
          {rejOpen.length > 6 && <div className="pl none">and {rejOpen.length - 6} more — sorted by what they would have paid</div>}
          {/* CR-8 · the fold. Present, counted, openable — never removed. */}
          {rejFolded.length > 0 && (
            <>
              <button type="button" className="pl none fold" id="leave-fold" aria-expanded={foldOpen} onClick={() => setFoldOpen((v: boolean) => !v)}>
                {foldOpen ? "▾" : "▸"} {rejFolded.length} folded — {foldCounts.map(([r, n]) => `${n} ${FOLD_LABEL[r]}`).join(" · ")} · arithmetic, not judgement: no override
              </button>
              {foldOpen && rejFolded.map((s) => card(s, "no"))}
            </>
          )}
        </div>
      )}

      {/* SPR-38 · the third bucket. These are not rejected — a gate could not be
          computed for want of a number. Shown apart so the board never reads
          "140 rejected" over cards that never failed a stock. */}
      {ncF.length > 0 && (
        <div className="plgrp">
          <span className="plk">NOT COMPUTED · {ncF.length}{board?.counts?.noRow ? ` · ${board.counts.noRow} with no row for this day` : ""}</span>
          {ncF.slice(0, 6).map((s) => card(s, "no"))}
          {ncF.length > 6 && <div className="pl none">and {ncF.length - 6} more — a statistic is missing, not a failed stock</div>}
        </div>
      )}

      {board && Object.keys(board.counts).length > 0 && (
        <p className="plan" style={{ marginTop: 16 }} id="board-gate-counts">
          Failures by gate:{" "}
          {Object.entries(board.counts)
            .filter(([k]) => !["all", "universe", "take", "oneAway", "priceWarn", "leave", "outOfReach", "belowTick", "suspended", "noRow", "recommended", "nearMiss", "rejected", "notComputed", "noQuotes", "noStats"].includes(k))
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
      )}
    </div>
  );
};
