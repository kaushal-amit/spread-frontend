/**
 * TopBar — the account strip, from /api/account, /api/budget, /api/session
 * and /api/market. Nothing computed here except formatting.
 *
 * The BUDGET field edits the slot the backend screens with (PUT /gates
 * {"session-budget": kd}) — one budget, persisted, the same number the board
 * uses. It used to edit a local variable that was cash + P&L, so every save
 * drifted by the day's P&L.
 */
import React, { useState, useEffect } from "react";
import { ViewMode } from "../types";
import { Maximize2, Minimize2, Columns2, BarChart2, MessageSquare, Edit2, Check } from "lucide-react";
import { fmt } from "../utils/format";
import { kuwaitHHMM } from "../lib/time";
import type { AccountState, Budget, SessionInfo, MarketDay, TradingContract, FeedHealth } from "../api/types";
import type { Live } from "../api/hooks";
import { apiPost } from "../api/client";

/**
 * 4.2 · every tile takes the hook's LIVE state, not only its data, so it can
 * say "loading" or "unavailable" instead of a dash that reads like a quiet
 * number. A tile never renders 0 for a value it does not have.
 */
interface TopBarProps {
  account: Live<AccountState>;
  budget: Live<Budget>;
  session: Live<SessionInfo>;
  market: Live<MarketDay>;
  contracts: Live<TradingContract[]>;
  /** SPR-30 · the capture-feed roster, so a dead orders feed is never a fabricated FLAT. */
  feeds: Live<FeedHealth>;
  errors: string[];
  connected: boolean;
  onBudgetSaved: () => void;
  /** The server's session day; null until /api/session has answered. */
  selectedDate: string | null;
  onDateChange: (date: string) => void;
  /** SPR-36 · bound the date input so impossible dates never round-trip. */
  minDate?: string;
  maxDate?: string;
  onToggleAdd: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

/** "loading" while the first fetch is in flight, "unavailable" after a failure, else the value. */
type TileState = "loading" | "unavailable" | "ok" | "stale";
/** "stale" = the last refresh FAILED and the value on screen is the previous one. */
const state = <T,>(h: Live<T>): TileState => (h.data ? (h.error ? "stale" : "ok") : h.loading ? "loading" : h.error ? "unavailable" : "loading");
const placeholder = (st: TileState) => (st === "loading" ? "…" : "n/a");
const staleCls = (st: TileState) => (st === "stale" ? "stale" : "");
const staleTitle = <T,>(h: Live<T>) => (h.error && h.data ? `STALE — last refresh failed (${(h.error as any).code || "error"}); value from ${kuwaitHHMM(h.at)} Kuwait` : null);

export const TopBar: React.FC<TopBarProps> = ({
  account: accountLive, budget: budgetLive, session: sessionLive, market: marketLive, contracts: contractsLive,
  feeds: feedsLive, errors, connected, onBudgetSaved, selectedDate, onDateChange, minDate, maxDate, onToggleAdd,
  viewMode = "split", onViewModeChange, isFullscreen = false, onToggleFullscreen,
}) => {
  const account = accountLive.data, budget = budgetLive.data, session = sessionLive.data,
    market = marketLive.data, contracts = contractsLive.data;
  const aSt = state(accountLive), bSt = state(budgetLive), cSt = state(contractsLive), mSt = state(marketLive), sSt = state(sessionLive);
  const slot = budget?.budget_kd ?? null;
  const [isEditing, setIsEditing] = useState(false);
  const [budgetString, setBudgetString] = useState(slot == null ? "" : String(slot));
  const [saveError, setSaveError] = useState<string | null>(null);
  // SPR-11 · show the saved value at once instead of waiting ~2-3s for the next
  // /budget poll. `shown` is the optimistic value until the poll catches up.
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const shown = optimistic ?? slot;

  useEffect(() => { if (!isEditing && shown != null) setBudgetString(String(shown)); }, [shown, isEditing]);
  useEffect(() => { if (optimistic != null && slot === optimistic) setOptimistic(null); }, [slot, optimistic]);

  const submit = async () => {
    const val = parseFloat(budgetString);
    setIsEditing(false);
    // SPR-11 · a refused value says WHY, instead of silently reverting.
    if (Number.isNaN(val) || val < 100) {
      setSaveError("minimum budget is 100 KD");
      setBudgetString(shown == null ? "" : String(shown));
      return;
    }
    if (val === shown) { setBudgetString(String(val)); return; }   // no change — no noise
    try {
      await apiPost("/gates", { changes: { "session-budget": val }, changedBy: "topbar" }, "PUT");
      setSaveError(null);
      setOptimistic(val);          // header reflects the save immediately
      onBudgetSaved();
    } catch (e: any) {
      setSaveError(e?.message || "save failed");
      setBudgetString(shown == null ? "" : String(shown));
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
    else if (e.key === "Escape") { setBudgetString(shown == null ? "" : String(shown)); setIsEditing(false); setSaveError(null); }
  };

  const open = (contracts || []).filter((c) => c.state !== "picked");

  // SPR-30 · a dead orders feed must not read as FLAT. The orders userscript
  // feeds the positions; when it is silent or absent, "no open positions" is
  // unknown, not a fact — so FLAT becomes an honest "FEED SILENT/ABSENT".
  const feeds = feedsLive.data;
  const ordersFeed = feeds?.available ? feeds.scripts.find((s) => s.script === "orders") : null;
  // No roster at all (/feeds failed, or the heartbeat table is absent) is not
  // "the orders feed is fine": it read FLAT. Unknown is unknown.
  const feedsUnknown = !feeds || feeds.available === false || (feeds.available && !ordersFeed);
  const ordersDown = feedsUnknown ? "unknown" : ordersFeed && ordersFeed.status !== "ok" ? ordersFeed.status : null;
  const ordersSince = ordersFeed?.lastSeenAt
    ? kuwaitHHMM(ordersFeed.lastSeenAt)
    : null;
  const posDisplay = open.length === 0
    ? (ordersDown ? (ordersDown === "unknown" ? "POSITION UNKNOWN" : ordersDown === "absent" ? "ORDERS FEED ABSENT" : ordersDown === "degraded" ? "ORDERS FEED DEGRADED" : `ORDERS FEED SILENT${ordersSince ? ` · since ${ordersSince}` : ""}`) : "FLAT")
    : open.length === 1 ? `LONG ${fmt(open[0].shares)} ${open[0].symbol}` : `${open.length} OPEN`;
  const posTooltip = open.length
    ? open.map((p) => `${p.symbol}: ${fmt(p.shares)} sh @ ${p.entry ?? "—"} (${fmt(Math.round(p.committedKd))} KD) [${p.state}]${p.markedAt === "entry" ? " — no quote today" : ""}`).join("\n")
    : ordersDown === "unknown" ? `the feed roster is unavailable${feedsLive.error ? ` (${(feedsLive.error as { message?: string }).message})` : ""} — whether the orders feed is alive is unknown, so this is not a flat book`
    : ordersDown ? `the orders feed is ${ordersDown}${ordersSince ? ` (last seen ${ordersSince})` : ""}${ordersFeed?.reason ? ` — ${ordersFeed.reason}` : ""} — positions cannot be confirmed, so this is not a flat book${ordersFeed?.problem ? `\n${ordersFeed.problem}` : ""}`
    : contracts ? "No open positions" : placeholder(cSt);

  // SPR-27/30 · any capture feed that is silent or absent, surfaced on the face.
  const badFeeds = feeds?.available ? feeds.scripts.filter((s) => s.status !== "ok") : [];

  const pnl = account?.todayKd ?? null;
  const pnlPct = account && account.netDepositedKd ? (account.todayKd / account.netDepositedKd) * 100 : null;
  const free = budget?.free_kd ?? null;
  // R-04 · min_position_kd comes from the server (it changes on 1 October); no
  // hardcoded 333 fallback that would survive the change silently. With the
  // budget not yet loaded there is nothing to warn against.
  const minPos = budget?.min_position_kd ?? null;
  const freeClass = free == null ? "" : free <= 0 ? "dn" : (minPos != null && free < minPos) ? "warn" : "";
  const freeFraction = budget && budget.budget_kd > 0 ? Math.max(0, Math.min(1, budget.free_kd / budget.budget_kd)) : 0;
  const blocks = Math.round(freeFraction * 6);
  const blockBar = "█".repeat(blocks) + "░".repeat(Math.max(0, 6 - blocks));

  // R-05 · the colour comes from the server's band, not a 35/50 rule re-derived here.
  const breadthClass = market?.breadthBand === "risk_on" ? "up" : market?.breadthBand === "risk_off" ? "dn" : "";

  // Session mode from the SERVER's clock, never the browser's.
  const today = session?.kuwaitDay ?? null;
  let modeText = sSt === "loading" ? "…" : "NO SESSION", modeClass = "past";
  if (today && selectedDate && selectedDate < today) { modeText = "REVIEW"; modeClass = "past"; }
  else if (today && selectedDate && selectedDate > today) { modeText = "PLANNING"; modeClass = "plan"; }
  else if (session) {
    // SPR-21 · STEP-DOWN read like a button. It is a TIME, not a control: the
    // afternoon drift-down is approaching (or here). Show the countdown from the
    // server's minutesToStepDown so it reads as "when", not "click me".
    const mins = session.minutesToStepDown;
    modeText = session.phase === "pre_open" ? "PRE-OPEN" : session.phase === "closed" ? "CLOSED"
      : session.phase === "step_down" ? (mins != null && mins > 0 ? `STEP-DOWN in ${mins}m` : "STEP-DOWN now")
      : session.phase === "peak" ? "PEAK" : "LIVE";
    // SPR-33 · "live" styling requires the push channel, not just an open
    // session — a dropped socket must not keep the pill lit green.
    modeClass = session.open ? (connected ? "live" : "past") : session.phase === "pre_open" ? "plan" : "past";
  }

  return (
    <div className="bar">
      <button className="addbtn" id="add-stock-btn" onClick={onToggleAdd}>+ ADD</button>

      <span className={`fld budget-fld ${isEditing ? "editing" : ""} ${staleCls(bSt)}`} id="budget-fld"
        onClick={() => { if (!isEditing && shown != null) setIsEditing(true); }}
        title={saveError ? saveError : "The slot the board screens with. Click to edit — saved to the gate store."}>
        <span className="k">SLOT</span>
        {isEditing ? (
          <span className="budget-edit-box">
            <input type="number" id="budget-input" autoFocus value={budgetString}
              onChange={(e) => setBudgetString(e.target.value)} onKeyDown={onKey} onBlur={submit} step="10" min="100" />
            <button type="button" className="budget-save-btn" onClick={(e) => { e.stopPropagation(); submit(); }} title="Save"><Check size={11} /></button>
          </span>
        ) : (
          <span className={`v budget-val-display ${saveError ? "dn" : ""}`} id="cash">
            {shown == null ? placeholder(bSt) : shown.toLocaleString(undefined, { minimumFractionDigits: 0 })}
            <Edit2 size={10} className="budget-edit-icon" />
          </span>
        )}
      </span>

      <span className={`fld ${staleCls(aSt)}`} id="equity-fld" title={staleTitle(accountLive) ?? (account ? `cash ${account.buyingPowerKd.toFixed(2)} · invested ${account.investedKd.toFixed(2)} · unrealised ${account.unrealisedKd.toFixed(2)}` : "")}>
        <span className="k">EQUITY</span>
        <span className="v" id="equity">{account ? account.equityKd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : placeholder(aSt)}</span>
      </span>

      <span className={`fld ${staleCls(aSt)}`} id="gain-loss-fld" title={staleTitle(accountLive) ?? (account ? `${account.todayTrips} round trip${account.todayTrips === 1 ? "" : "s"} today · since 28 Jul ${account.since28JulKd.toFixed(2)}` : "")}>
        <span className="k">TODAY</span>
        <span className={`v ${pnl == null ? "" : pnl > 0 ? "up" : pnl < 0 ? "dn" : ""}`} id="dayp">
          {pnl == null ? placeholder(aSt) : `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}`}
          {pnlPct != null && <small>{pnlPct > 0 ? "+" : ""}{pnlPct.toFixed(2)}%</small>}
        </span>
      </span>

      <span className={`fld ${staleCls(cSt)} ${ordersDown ? "warn" : ""}`} id="position-fld" title={staleTitle(contractsLive) ?? posTooltip} style={{ cursor: (open.length || ordersDown) ? "help" : "default" }}>
        <span className="k">POSITION</span>
        <span className={`v ${ordersDown ? "dn" : ""}`} id="posn" style={{ fontSize: "12px", letterSpacing: ".06em" }}>
          {(contracts || ordersDown) ? posDisplay : placeholder(cSt)}
        </span>
      </span>

      <span className={`fld free-fld ${freeClass} ${staleCls(bSt)}`} id="free-fld"
        title={budget ? `Free: ${fmt(Math.round(budget.free_kd))} KD | Committed: ${fmt(Math.round(budget.committed_kd))} KD | Reserve: ${fmt(Math.round(budget.reserve_kd))}` : ""}>
        <span className="k">FREE</span>
        <span className={`v ${freeClass}`} id="free-val">{free == null ? placeholder(bSt) : <>{fmt(Math.round(free))} <span className="block-bar">{blockBar}</span></>}</span>
      </span>

      <span className={`fld reserve-fld ${staleCls(bSt)}`} id="reserve-fld" title="Held back until 11:00 Kuwait — reserve_pct and reserve_release_hhmm in kb_threshold.">
        <span className="k">RESERVE</span>
        <span className="v" id="reserve-val">
          {budget ? fmt(Math.round(budget.reserve_kd)) : placeholder(bSt)}
          <small className="reserve-sub"> · {budget ? (budget.reserve_held ? `until ${String(budget.reserve_releases_at_hhmm).replace(/(\d\d)(\d\d)/, "$1:$2")}` : "released") : ""}</small>
        </span>
      </span>

      <span className={`fld ${staleCls(mSt)}`} id="mkt" style={{ marginLeft: "auto" }} title={market?.available ? `${market.regime || ""} · 5d avg ${market.breadth5dAvgPct}%${market.isToday ? "" : " · prior session"}` : market ? "no market_day row for this session" : `market: ${mSt}`}>
        <span className="k">BREADTH</span>
        <span className={`v ${breadthClass}`} id="brv">
          {market?.available ? `${market.breadthPct.toFixed(0)}%` : market ? "no row" : placeholder(mSt)}
          {market?.available && <small>{market.up}▲ {market.down}▼</small>}
          {/* SPR-12 · this is the prior session's close, not live — say so on the
              face, not only in the tooltip, so it is never read as live breadth. */}
          {market?.available && !market.isToday && <small className="prior-tag"> · prior close</small>}
        </span>
      </span>

      {/* SPR-27/30 · a capture feed that stopped is shown here, not left to be
          inferred from an empty board. `absent` never checked in; `silent`
          checked in then stopped. */}
      {badFeeds.length > 0 && (
        <span className="fld" id="feed-health" title={badFeeds.map((s) => `${s.script}: ${s.status}${s.reason ? ` — ${s.reason}` : ""}${s.lastSeenAt ? ` — last seen ${kuwaitHHMM(s.lastSeenAt)} Kuwait` : ""}${s.problem ? ` (${s.problem})` : ""}`).join("\n")}>
          <span className="k">FEEDS</span>
          <span className="v dn">{badFeeds.map((s) => `${s.script} ${s.status}`).join(" · ")}</span>
        </span>
      )}

      {/* 4.6 · the API chip: any failing fetch, or a socket that cannot connect.
          SPR-39 · a single failure names its endpoint on the face; the tooltip
          lists all of them with the code and message — never a bare "1 failing". */}
      {(errors.length > 0 || !connected) && (
        <span className="fld" id="api-errors" title={[...errors, connected ? null : "socket: not connected — the board is not live"].filter(Boolean).join("\n")}>
          <span className="k">API</span>
          <span className="v dn">
            {errors.length === 1 ? `${errors[0].split(" — ")[0]} failing`
              : errors.length ? `${errors.length} failing` : "not live"}
            {errors.length && !connected ? " · not live" : ""}
          </span>
        </span>
      )}

      <span className="dpick" id="date-picker-wrap">
        <input type="date" id="dsel" value={selectedDate ?? ""} disabled={selectedDate == null} min={minDate} max={maxDate} onChange={(e) => onDateChange(e.target.value)} aria-label="Session date"
          title={selectedDate == null ? "waiting for /api/session — the session day is the server's" : "the server's session day (rolls 04:00 Kuwait)"} />
        {/* SPR-42 · the mode label alone. The trailing clock always read "now",
            never the event's time (STEP-DOWN 11:31 was the current time, not the
            step-down time), so it read like a broken control. The mode words say
            when; the wall clock belongs elsewhere. */}
        <span className={`mode ${modeClass}`} id="dmode" title={session?.note || ""}>{modeText}</span>
      </span>

      {onViewModeChange && (
        <div className="view-mode-group" id="view-mode-group" role="group" aria-label="Layout view mode">
          <button type="button" className={`view-btn ${viewMode === "split" ? "active" : ""}`} onClick={() => onViewModeChange("split")} title="Split view" aria-label="Split view" id="view-mode-split"><Columns2 size={13} /></button>
          <button type="button" className={`view-btn ${viewMode === "analytics" ? "active" : ""}`} onClick={() => onViewModeChange("analytics")} title="Full Analytics view" aria-label="Full Analytics view" id="view-mode-analytics"><BarChart2 size={13} /></button>
          <button type="button" className={`view-btn ${viewMode === "chat" ? "active" : ""}`} onClick={() => onViewModeChange("chat")} title="Full Chat view" aria-label="Full Chat view" id="view-mode-chat"><MessageSquare size={13} /></button>
        </div>
      )}

      {onToggleFullscreen && (
        <button type="button" className={`fullscreen-btn ${isFullscreen ? "active" : ""}`} onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen"} aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"} id="fullscreen-toggle-btn">
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      )}
    </div>
  );
};
