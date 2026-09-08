/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * App — the terminal's frame. Every number on every surface comes from the
 * backend (src/api). There is no fixture data left in this build: data.ts,
 * ActionBlock and LadderDOM (the prototype) are gone, and with them the 1.5 s
 * random walk, the scripted alerts and the browser-side fee arithmetic.
 *
 *   TODAY     the board          /api/stocks + spread:update, /api/market, /api/budget
 *   <symbol>  the detail page    /api/stocks/:symbol/detail + spread:book, writes to /trading/*
 *   BOOKS     the depth sweep    /ingest/* (scraper) + spread:book
 *   STATES    a static reference to the state machine and the server's refusals
 */
import { kuwaitHHMM } from "./lib/time";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FeedEvent, AlertState, ViewMode } from "./types";
import { TopBar } from "./components/TopBar";
import { TabBar, type LiveChip } from "./components/TabBar";
import { SessionBanner } from "./components/SessionBanner";
import { SymbolSearch } from "./components/SymbolSearch";
import { StockDetail } from "./components/StockDetail";
import { TodayView } from "./components/TodayView";
import { StatesView } from "./components/StatesView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BooksView } from "./live/BooksView";
import "./live/books.css";
import { FeedSection } from "./components/FeedSection";
import { AskBar } from "./components/AskBar";
import { useAccount, useAlerts, useBoard, useBudget, useContracts, useDetail, useMarket, useSession, useSessions, useReviewBoard, useFeeds, fetchFeedHistory, isSelectableSession } from "./api/hooks";
import { Columns2, MessageSquare } from "lucide-react";

type Tab = "TODAY" | "BOOKS" | "STATES" | { symbol: string };

// SPR-10 · review-table rendering. The stored values are clean; the damage was
// all in the render: raw floats (0.9000000000000057), no thousands separators
// (volume and trades ran together), and a "quality" header on a capture-coverage
// column. chg rounds to the tick — 1 decimal under 100 fils, integer at/above.
const rvNumStyle: React.CSSProperties = { padding: "2px 14px 2px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const rvTxtStyle: React.CSSProperties = { padding: "2px 14px 2px 0", textAlign: "left" };
const rvInt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const rvChg = (chg: number | null | undefined, close: number | null | undefined) => {
  if (chg == null) return "—";
  const n = Number(chg);
  const dp = close != null && Number(close) < 100 ? 1 : 0;
  return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(dp);
};

export default function App() {
  // ── live state ──────────────────────────────────────────────────────────
  const board = useBoard();
  const account = useAccount(board.tick);
  const budgetLive = useBudget(board.tick);
  const session = useSession();
  const market = useMarket();
  const contractsLive = useContracts(board.tick);
  const feeds = useFeeds();

  const [tab, setTab] = useState<Tab>("TODAY");
  const curSymbol = typeof tab === "object" ? tab.symbol : null;
  const detail = useDetail(curSymbol, board.tick);

  // SPR-39 · name the failing call. "API · 1 failing" with no endpoint is a dead
  // end; each error now carries its source so the chip and tooltip say which.
  const apiErrors = ([
    ["/stocks", board], ["/account", account], ["/budget", budgetLive], ["/session", session],
    ["/market", market], ["/trading/contracts", contractsLive], ["/stocks/:sym/detail", detail],
  ] as const)
    .filter(([, h]) => h.error)
    .map(([name, h]) => `${name} — ${(h.error as any).code || "ERR"}: ${h.error!.message}`);

  const [showSearch, setShowSearch] = useState(false);
  // 4.3 · the session day is the SERVER's (rolls at 04:00 Kuwait). Until
  // /api/session answers there is no date — never the browser's UTC day.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    if (selectedDate == null && session.data?.kuwaitDay) setSelectedDate(session.data.kuwaitDay);
  }, [session.data, selectedDate]);

  // R-18 · the picker is driven by /api/sessions: only days that traded (and
  // today) are selectable, and a past date puts the screen in read-only review.
  const sessions = useSessions();
  const today = session.data?.kuwaitDay ?? null;
  const reviewMode = !!selectedDate && !!today && selectedDate < today;
  const reviewBoard = useReviewBoard(selectedDate, reviewMode);
  const onDatePicked = useCallback((date: string) => {
    if (isSelectableSession(date, today, (sessions.data?.sessions ?? []).map((s) => s.date))) { setSelectedDate(date); return; }
    addFeed({ id: `nosession-${date}`, s: "—", k: "NO SESSION", c: "warn", u: 0,
      p: `${date} did not trade — it is not in /api/sessions and cannot be reviewed.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data, today]);

  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const analyticsScrollRef = useRef<HTMLDivElement>(null);

  // ── feed: questions, answers, and the server's alerts ───────────────────
  const [feed, setFeed] = useState<FeedEvent[]>([{
    id: "feed-boot", t: kuwaitHHMM(Date.now()), s: "—", k: "FEED", c: "info", u: 0,
    p: "Your questions, the engine's answers, and the server's alerts (sell-not-posted, stranded orders, entry windows, wake-ups, the 12:30 flatten) appear here. Nothing here is invented.",
  }]);
  const [alert, setAlert] = useState<AlertState>({ on: false, kind: "", sym: "", key: "", txt: "" });
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 4.6 · every event has an id, assigned HERE, so a row key is never an index.
  const seq = useRef(0);
  const addFeed = useCallback((e: { s: string; k: string; c: string; p: string; u: number; id?: string }) => {
    const id = e.id || `ev-${Date.now()}-${(seq.current += 1)}`;
    setFeed((prev) => [{ ...e, id, t: kuwaitHHMM(Date.now()) }, ...prev].slice(0, 400));
  }, []);

  const onAlert = useCallback((e: { s: string; k: string; c: string; p: string; u: number }) => {
    addFeed(e);
    // The banner, unless we are already looking at that symbol.
    if (e.s !== "—" && curSymbol === e.s) return;
    setAlert({ on: true, kind: e.c, sym: e.s, key: e.k, txt: e.p });
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setAlert((a) => ({ ...a, on: false })), 14000);
  }, [addFeed, curSymbol]);
  useAlerts(onAlert);
  useEffect(() => () => { if (alertTimerRef.current) clearTimeout(alertTimerRef.current); }, []);

  // SPR-07/08 · replay the feed from the server once, so a reload does not lose
  // the entry windows and halt resumes the server recorded. Merged above the
  // boot line, newest first; live pushes then prepend on top. De-duped by id so
  // a live event that also comes back in the replay is not shown twice.
  const feedSeeded = useRef(false);
  useEffect(() => {
    if (feedSeeded.current) return;
    feedSeeded.current = true;
    fetchFeedHistory()
      .then((hist) => setFeed((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const add = hist.filter((e) => !ids.has(e.id));
        return [...add, ...prev].slice(0, 400);
      }))
      .catch(() => { /* a feed that will not replay is not a reason to block the terminal */ });
  }, []);

  // ── navigation ──────────────────────────────────────────────────────────
  const openSymbol = useCallback((symbol: string) => {
    setTab({ symbol: symbol.toUpperCase() });
    setShowSearch(false);
    if (analyticsScrollRef.current) analyticsScrollRef.current.scrollTop = 0;
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
  }, []);
  const pickTab = useCallback((index: number) => {
    setTab(index === -98 ? "BOOKS" : index === -99 ? "STATES" : "TODAY");
  }, []);
  const handlePopGo = useCallback(() => {
    setAlert((a) => ({ ...a, on: false }));
    if (alert.sym && alert.sym !== "—") openSymbol(alert.sym);
  }, [alert.sym, openSymbol]);

  const handleReadFeedEvent = useCallback((event: FeedEvent) => {
    setFeed((prev) => prev.map((e) => (e.id === event.id ? { ...e, u: 0 } : e)));
    if (event.s && event.s !== "—" && event.s !== "TODAY" && event.s !== curSymbol) openSymbol(event.s);
  }, [curSymbol, openSymbol]);
  const handleMarkAllFeedRead = useCallback(() => setFeed((prev) => prev.map((e) => ({ ...e, u: 0 }))), []);

  // ── fullscreen ──────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  // ── derived ─────────────────────────────────────────────────────────────
  const liveChips = useMemo(() => {
    if (!board.data) return null;
    const chips: LiveChip[] = [
      ...(contractsLive.data || []).filter((c) => c.state !== "picked").map((c) => ({ symbol: c.symbol, price: c.bid, kind: "open" as const })),
      ...board.data.recommended.map((s) => ({ symbol: s.symbol, price: s.price, kind: "go" as const })),
      ...board.data.nearMiss.slice(0, 10).map((s) => ({ symbol: s.symbol, price: s.price, kind: "near" as const })),
    ];
    if (curSymbol && !chips.some((c) => c.symbol === curSymbol)) {
      const s = board.data.all.find((x) => x.symbol === curSymbol);
      chips.push({ symbol: curSymbol, price: s?.price ?? null, kind: "near" as const });
    }
    return chips.filter((c, i, a) => a.findIndex((x) => x.symbol === c.symbol) === i);
  }, [board.data, contractsLive.data, curSymbol]);

  const filteredFeed = useMemo(() => {
    if (tab === "STATES") return feed.filter((e) => e.s === "STATES");
    if (curSymbol) return feed.filter((e) => e.s === curSymbol);
    return feed.filter((e) => e.s === "TODAY" || e.s === "—");
  }, [feed, tab, curSymbol]);
  const feedHeaderLabel = tab === "STATES" ? "STATES" : curSymbol || "TODAY";

  const onTradeChanged = useCallback(() => { detail.refresh(); contractsLive.refresh(); account.refresh(); budgetLive.refresh(); board.refresh(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail.refresh, contractsLive.refresh, account.refresh, budgetLive.refresh, board.refresh]);

  const curIndex = tab === "BOOKS" ? -98 : tab === "STATES" ? -99 : curSymbol ? 0 : -1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ErrorBoundary name="TOPBAR">
      <TopBar
        account={account} budget={budgetLive} session={session} market={market}
        contracts={contractsLive} feeds={feeds} errors={apiErrors} connected={board.connected}
        onBudgetSaved={() => { budgetLive.refresh(); board.refresh(); }}
        selectedDate={selectedDate} onDateChange={onDatePicked}
        onToggleAdd={() => setShowSearch((p) => !p)}
        viewMode={viewMode} onViewModeChange={setViewMode}
        isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
      />
      </ErrorBoundary>

      <TabBar
        liveChips={liveChips} onPickSymbol={openSymbol}
        cur={curIndex} curSymbol={curSymbol} alert={alert}
        onPick={pickTab} onClose={() => setTab("TODAY")} onPopGo={handlePopGo}
      />

      {/* SPR-33 · a dropped push channel is SHOWN, not left reading "live" on
          stale data. Appears once the board has loaded at least once and the
          socket is not connected; socket.io reconnects underneath. */}
      {!board.connected && board.at != null && (
        <div className="session-banner session-danger" id="conn-banner" role="status">
          <span className="session-banner-pip" />
          <span className="session-banner-title">LIVE FEED LOST — reconnecting…</span>
          <span className="session-banner-why">
            {board.disconnectedSince ? `since ${kuwaitHHMM(board.disconnectedSince)} Kuwait · ` : ""}showing the last update, not live
          </span>
        </div>
      )}

      {/* SPR-04/05 · session mode, from the tick — the single source, always
          mounted so it never blinks out on a view switch (SPR-15). */}
      <SessionBanner stops={board.data?.stops} />

      <SymbolSearch show={showSearch} all={board.data?.all || []}
        onPick={(s) => { openSymbol(s); setShowSearch(false); }} onClose={() => setShowSearch(false)} />

      <div className={`main split-layout layout-${viewMode} ${isFullscreen ? "is-fullscreen" : ""}`} id="main" ref={mainScrollRef}>
        {(viewMode === "split" || viewMode === "chat") && (
          <aside className={`chat-pane ${viewMode === "chat" ? "chat-pane-full" : ""}`} id="chat-pane" aria-label="Engine & Live Feed">
            <div className="chat-content">
              <ErrorBoundary name="FEED">
                <FeedSection headerLabel={feedHeaderLabel} events={filteredFeed}
                  onReadEvent={handleReadFeedEvent} onMarkAllRead={handleMarkAllFeedRead}
                  viewMode={viewMode} onToggleViewMode={setViewMode} />
              </ErrorBoundary>
            </div>
            <div className="chat-input-wrapper">
              <ErrorBoundary name="ASK">
                <AskBar curSymbol={curSymbol} onAddFeedEvent={(e) => addFeed(e)} />
              </ErrorBoundary>
            </div>
          </aside>
        )}

        {(viewMode === "split" || viewMode === "analytics") && (
          <main className={`analytics-pane ${viewMode === "analytics" ? "analytics-pane-full" : ""}`} id="analytics-pane" ref={analyticsScrollRef} aria-label="Board & Detail">
            {viewMode === "analytics" && (
              <div className="analytics-top-bar" id="analytics-top-bar">
                <span className="analytics-top-label">FULL ANALYTICS MODE · {curSymbol || (tab === "STATES" ? "STATES" : tab === "BOOKS" ? "BOOKS" : "TODAY")}</span>
                <div className="analytics-top-actions">
                  <button type="button" className="view-btn" onClick={() => setViewMode("split")} title="Split view" aria-label="Split view" id="btn-analytics-back-split"><Columns2 size={13} /></button>
                  <button type="button" className="view-btn" onClick={() => setViewMode("chat")} title="Chat" aria-label="Chat" id="btn-analytics-to-chat"><MessageSquare size={13} /></button>
                </div>
              </div>
            )}
            <div id="panel">
              {tab === "BOOKS" ? <ErrorBoundary name="BOOKS"><BooksView /></ErrorBoundary>
                : tab === "STATES" ? <ErrorBoundary name="STATES"><StatesView /></ErrorBoundary>
                : curSymbol ? (
                  <ErrorBoundary name={curSymbol} onReset={detail.refresh}>
                    <StockDetail symbol={curSymbol} detail={detail.data} error={detail.error} loading={detail.loading}
                      detailAt={detail.at} bookAt={detail.bookAt} connected={board.connected}
                      stops={board.data?.stops ?? null} readOnly={reviewMode}
                      onChanged={onTradeChanged} onFeed={addFeed} />
                  </ErrorBoundary>
                ) : reviewMode ? (
                  <ErrorBoundary name="REVIEW">
                    <div id="review-board" className="review-board">
                      <p className="plan warn" id="review-banner"><b>REVIEW — read only.</b> {selectedDate}: the session as it was recorded. Select today to trade.</p>
                      {reviewBoard.loading && <p className="hint">loading the session…</p>}
                      {reviewBoard.error && <p className="plan warn">could not load {selectedDate}: {reviewBoard.error.message}</p>}
                      {reviewBoard.data && (
                        <table className="review-table" id="review-symbols" style={{ borderCollapse: "collapse" }}>
                          <thead><tr>
                            <th style={rvTxtStyle}>symbol</th><th style={rvNumStyle}>close</th><th style={rvNumStyle}>chg</th>
                            <th style={rvNumStyle}>volume</th><th style={rvNumStyle}>trades</th><th style={rvTxtStyle}>capture</th>
                          </tr></thead>
                          <tbody>
                            {reviewBoard.data.symbols.map((s) => (
                              <tr key={s.symbol}>
                                <td style={rvTxtStyle}>{s.symbol}</td>
                                <td style={rvNumStyle}>{s.close_px ?? "—"}</td>
                                <td style={rvNumStyle}>{rvChg(s.chg_fils, s.close_px)}</td>
                                <td style={rvNumStyle}>{rvInt(s.total_volume)}</td>
                                <td style={rvNumStyle}>{rvInt(s.trades)}</td>
                                <td style={rvTxtStyle}>{s.data_quality ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </ErrorBoundary>
                ) : (
                  <ErrorBoundary name="TODAY" onReset={board.refresh}>
                    <TodayView board={board.data} boardError={board.error} boardLoading={board.loading} connected={board.connected}
                      boardAt={board.at} market={market} budget={budgetLive} contracts={contractsLive} onPickSymbol={openSymbol} />
                  </ErrorBoundary>
                )}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
