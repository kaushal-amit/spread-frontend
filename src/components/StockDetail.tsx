/**
 * StockDetail — the half you use once you are in a trade.
 *
 * Replaces the prototype's ActionBlock + LadderDOM. Every figure comes from
 * GET /api/stocks/:symbol/detail (card, book, sizing, fill time, depth signal,
 * the open contract and today's legs) and every button is a write the backend
 * validates:
 *
 *   POST BID       → POST /trading/record   {side BUY,  status POSTED}
 *   BID FILLED     → POST /trading/resolve  {legId, FILLED, filledShares?, executions?}
 *   CANCELLED      → POST /trading/resolve  {legId, CANCELLED}
 *   POST OFFER     → POST /trading/record   {side SELL, status POSTED}
 *   OFFER FILLED   → POST /trading/resolve  {legId, FILLED}
 *   HIT THE BID    → POST /trading/hit-bid
 *
 * The STATE is derived from the legs the server returns — never kept here.
 * A refusal (409) is shown verbatim: the server knows which contract is open.
 *
 * Both tape figures are on the card: the blended one Gate 5 reads, and the
 * scraper's up-only one beside it. When up-only is double the blended, the
 * up-moves are the small prints and the stock is being walked up.
 */
import React, { useEffect, useMemo, useState } from "react";
import type { Detail, DetailLeg, TradeResult, BookLevel, SessionStops } from "../api/types";
import { apiPost, ApiError } from "../api/client";
import { fmt, kd, hhmm } from "../utils/format";
import { ageSec, ageLabel, kuwaitHHMMSS } from "../lib/time";

/**
 * R-11 · a ladder is STALE when the socket is down, or when the capture behind
 * it is older than 3 × the scraper's capture interval with no push. The interval
 * comes from the server (detail.captureIntervalSecs, from QUALITY) — a client
 * constant drifts from the scraper and reads a stopped feed as a quiet book.
 */
const staleSecFrom = (captureIntervalSecs?: number) => 3 * (captureIntervalSecs && captureIntervalSecs > 0 ? captureIntervalSecs : 33);

type Phase = "WATCH" | "QUEUED_BID" | "HOLDING" | "QUEUED_OFFER" | "DONE";

/**
 * 4.4 · one ladder row, memoised on its own level. A `spread:book` push
 * replaces the level arrays, but a row whose price, qty, change and marker
 * are unchanged is not re-rendered — ten levels a side, twenty rows, and a
 * tick that moved one qty renders one row.
 */
const LadderRow = React.memo(function LadderRow({ l, side, touch, mx, mark, markCls, note }:
  { l: BookLevel; side: "b" | "o"; touch: boolean; mx: number; mark: string | null; markCls: string | null; note: string }) {
  return (
    <div className={`lr ${side} ${markCls ?? ""} ${touch ? "touch" : ""} ${l.changed !== "same" ? `bk-${l.changed}` : ""}`}
      title={l.prevQty != null && l.changed !== "same" ? `${l.changed}: was ${fmt(l.prevQty)}` : undefined}>
      <span className="mk">{mark ? "◆" : l.changed === "thinned" ? "▽" : l.changed === "thickened" ? "△" : ""}</span>
      <span className="px">{l.price}</span>
      <span className="qt">{fmt(l.qty)}</span>
      <span className="bx"><i style={{ width: `${(l.qty / mx) * 100}%` }}></i></span>
      <span className="note">{note}</span>
    </div>
  );
}, (a, b) => a.l.price === b.l.price && a.l.qty === b.l.qty && a.l.changed === b.l.changed && a.l.prevQty === b.l.prevQty
  && a.side === b.side && a.touch === b.touch && a.mx === b.mx && a.mark === b.mark && a.markCls === b.markCls && a.note === b.note);

function phaseOf(d: Detail): { phase: Phase; postedBuy?: DetailLeg; postedSell?: DetailLeg } {
  const posted = d.legs.filter((l) => l.status === "POSTED");
  const postedBuy = posted.find((l) => l.side === "BUY");
  const postedSell = posted.find((l) => l.side === "SELL");
  if (d.contract && d.contract.state !== "picked") return { phase: postedSell ? "QUEUED_OFFER" : "HOLDING", postedSell };
  if (postedBuy) return { phase: "QUEUED_BID", postedBuy };
  if (d.closedToday.length) return { phase: "DONE" };
  return { phase: "WATCH" };
}

interface Props {
  symbol: string;
  detail: Detail | null;
  error: Error | null;
  loading: boolean;
  /** when the bundle was last fetched, and when the ladder was last pushed */
  detailAt: number | null;
  bookAt: number | null;
  connected: boolean;
  /** R-19 / R-20 · the market gate and session stops; POST BID is blocked when canOpen is false. */
  stops: SessionStops | null;
  /** R-18 · a past session is review — read only. Every write button is disabled. */
  readOnly?: boolean;
  onChanged: () => void;
  onFeed: (e: { s: string; k: string; c: string; p: string; u: number }) => void;
}

export const StockDetail: React.FC<Props> = ({ symbol, detail, error, loading, detailAt, bookAt, connected, stops, readOnly = false, onChanged, onFeed }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ cls: string; text: string } | null>(null);
  const [price, setPrice] = useState<string>("");
  const [kdIn, setKdIn] = useState<string>("");
  const [filled, setFilled] = useState<string>("");
  const [execs, setExecs] = useState<string>("");

  const st = useMemo(() => (detail ? phaseOf(detail) : null), [detail]);
  // A message or a typed price belongs to ONE symbol. Switching tabs clears them.
  useEffect(() => { setMsg(null); setPrice(""); setKdIn(""); setFilled(""); setExecs(""); }, [symbol]);

  const call = async (label: string, path: string, body: unknown) => {
    // R-18 · review is read-only — a past-session screen must never trigger a
    // live write. The buttons are disabled, and this is the belt to that brace.
    if (readOnly) { setMsg({ cls: "bad", text: "review — read only. Select today to trade." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<TradeResult>(path, body);
      const text = [r.warning ? `Warning: ${r.warning}` : null, r.note || null,
        r.commissionKnown === false ? "commission is a best case — execution count unknown" : null].filter(Boolean).join(" · ");
      setMsg({ cls: r.warning ? "warn" : "ok", text: text || `${label} recorded.` });
      onFeed({ s: symbol, k: label.toUpperCase(), c: r.warning ? "warn" : "up", p: text || `${label} recorded.`, u: 0 });
      setFilled(""); setExecs("");
      onChanged();
    } catch (e: any) {
      const ae = e as ApiError;
      const text = `${ae.code || "ERROR"}: ${ae.message}${ae.detail ? " — " + ae.detail : ""}`;
      setMsg({ cls: "bad", text });
      onFeed({ s: symbol, k: `${label.toUpperCase()} REFUSED`, c: "warn", p: text, u: 1 });
    } finally { setBusy(false); }
  };

  // 4.2 · a failed refresh does not erase the last bundle: it is shown, marked
  // stale, with the error. UNAVAILABLE is for when there is nothing to show.
  if (error && !detail) return <div className="act stop" id="act-block"><div className="actgrid"><div className="left">
    <div className="ahead"><span className="sym">{symbol}</span></div>
    <div className="verb"><span className="v">UNAVAILABLE</span></div>
    <p className="why">{(error as any).code || "error"}: {error.message}</p></div></div></div>;
  if (!detail || !st) return <div className="act wait" id="act-block"><div className="actgrid"><div className="left">
    <div className="ahead"><span className="sym">{symbol}</span></div>
    <div className="verb"><span className="v">{loading ? "LOADING" : "NO DATA"}</span></div>
    <p className="why">{loading ? `fetching /stocks/${symbol}/detail…` : "the detail bundle returned nothing — not an empty book, no answer"}</p></div></div></div>;

  const c = detail.candidate;
  const book = detail.orderBook;
  const sz = detail.sizing;
  const ft = detail.fillTime;
  const pos = detail.contract;
  const { phase } = st;

  // Suggested entry: the candidate's bid (the board's suggestEntry ran server-side) else the touch.
  const entryPx = c?.bid || book?.bid || sz.price_fils || 0;
  const defaultKd = sz.suggested_kd ?? (sz.reachable ? sz.ceiling_kd : null);
  const useKd = kdIn ? Number(kdIn) : defaultKd;
  const usePx = price ? Number(price) : entryPx;
  // R-06 · the authoritative, lot-rounded size is the server's suggested_shares
  // (only pricing.js rounds lots). When the operator overrides price or KD, the
  // browser shows a plain preview of what they typed — an echo of their input,
  // not a gate or a fee calc — which they confirm in Awsat before tapping GO.
  const overriding = !!kdIn || !!price;
  const previewShares = useKd && usePx ? Math.floor((useKd * 1000) / usePx) : 0;
  const shares = overriding ? previewShares : (sz.suggested_shares ?? previewShares);

  const verb = phase === "WATCH" ? (c ? c.verdict.replace("_", " ") : "NO CARD")
    : phase === "QUEUED_BID" ? "QUEUED BID" : phase === "HOLDING" ? (pos?.state === "carried" ? "CARRIED" : "HOLDING")
    : phase === "QUEUED_OFFER" ? "QUEUED OFFER" : "DONE";
  const cls = phase === "WATCH" ? (c?.status === "recommended" ? "go" : c?.isStructuralFailure ? "stop" : "") : phase === "DONE" ? "done" : "wait";
  const at = phase === "WATCH" ? (c ? `${c.price}` : "") : phase === "QUEUED_BID" ? `${st.postedBuy?.price}` : phase === "HOLDING" ? `${pos?.entry}` : phase === "QUEUED_OFFER" ? `${st.postedSell?.price}` : kd(detail.closedToday.reduce((a, x) => a + x.netKd, 0));

  const why = phase === "WATCH"
    ? (c ? (c.status === "recommended" ? c.takeItBecause || "passes every gate"
        : c.notComputed.length ? `NOT COMPUTED: ${c.notComputed.join(", ")}` : `${c.failingGateNames.join(", ")}${c.rejectionDetail ? " — " + c.rejectionDetail : ""}`)
        : "no row on today's board for this symbol")
    : phase === "QUEUED_BID" ? `${fmt(st.postedBuy?.shares)} resting at ${st.postedBuy?.price} since ${hhmm(st.postedBuy?.postedAt)}${ft ? ` · queue ahead ${fmt(ft.queueAheadShares)} (${ft.queueSharePct ?? "?"}% yours) · fill ${ft.label}` : ""}`
    : phase === "HOLDING" ? `Long ${fmt(pos?.shares)} from ${pos?.entry ?? "—"}. ${pos?.bid == null ? "No quote today — unrealised unknown" : `Bid ${pos.bid} · ${kd(pos.unrealisedKd)} KD`}. Break-even ${pos?.breakEvenPrice ?? "—"} · target ${pos?.targetNormal ?? "—"} (+6 ${pos?.targetTrending ?? "—"} trending)${detail.stop?.stopFils != null ? ` · stop ${detail.stop.stopFils}` : ""}.${pos && pos.shares !== pos.boughtShares ? ` ${fmt(pos.boughtShares - pos.shares)} already sold.` : ""}`
    : phase === "QUEUED_OFFER" ? `Selling ${fmt(st.postedSell?.shares)} at ${st.postedSell?.price} since ${hhmm(st.postedSell?.postedAt)}. Long ${fmt(pos?.shares)} from ${pos?.entry}.`
    : detail.closedToday.map((x) => `C${x.seq}: bought ${x.entry}, sold ${x.exit}, ${fmt(x.shares)} sh, ${kd(x.netKd)} KD after ${x.feesKd.toFixed(2)} fees`).join(" · ");

  const g5 = c?.gateGroups.flatMap((g) => g.cells).find((x) => x.label === "Tape quality");
  // R-06 · the server decides walkedUp (funnel gate 5); the browser only shows it.
  const walkedUp = !!c?.metrics.walkedUp;

  // ── ladder ──
  const mine: { price: number; label: string; cls: string }[] = [];
  if (st.postedBuy) mine.push({ price: st.postedBuy.price, label: "my bid", cls: "mine" });
  if (st.postedSell) mine.push({ price: st.postedSell.price, label: "my offer", cls: "mine" });
  if (pos && phase !== "WATCH" && pos.entry != null) mine.push({ price: pos.entry, label: "entry", cls: "mine" });
  if (phase === "WATCH" && c?.status === "recommended") mine.push({ price: entryPx, label: "post here", cls: "act-buy" });
  const mx = Math.max(1, ...(book?.bids || []).map((l) => l.qty), ...(book?.offers || []).map((l) => l.qty));
  const row = (l: BookLevel, side: "b" | "o", touch: boolean) => {
    const m = mine.find((x) => x.price === l.price);
    // R-24 · the deterministic markers (server-computed) are the read of the row.
    // They take the note when present; "% yours" shows only on a bare bid level.
    const markerNote = (l.markers ?? []).map((k) => k.text).filter(Boolean).join(" · ");
    const primary = (l.markers ?? [])[0]?.event?.toLowerCase();
    return <LadderRow key={`${side}-${l.price}`} l={l} side={side} touch={touch} mx={mx}
      mark={m ? m.label : null} markCls={m ? m.cls : (primary ? `bk-${primary}` : null)}
      note={m ? m.label : (markerNote || (yourShares && side === "b" && l.qty ? `${((yourShares / l.qty) * 100).toFixed(1)}% yours` : ""))} />;
  };
  // Stale: no socket, or the capture behind the ladder is old. bookAt is the
  // last push for THIS symbol; lastTickTime is the capture instant it carried.
  const captureAt = book?.lastTickTime ?? null;
  const captureAge = ageSec(captureAt);
  const pushAge = ageSec(bookAt);
  const staleSec = staleSecFrom(detail.captureIntervalSecs);
  const ladderStale = !!book && (!connected || !!error || (captureAge != null && captureAge > staleSec && (pushAge == null || pushAge > staleSec)));
  // R-06 · the ladder's "% yours" uses the server's lot-rounded suggested size.
  const yourShares = detail.yourShares ?? sz.suggested_shares ?? 0;
  const offers = [...(book?.offers || [])].sort((a, b) => b.price - a.price);   // high → low, touch last
  const bids = [...(book?.bids || [])].sort((a, b) => b.price - a.price);       // touch first

  const btn = (id: string, klass: string, label: string, onClick: () => void, disabled = false) => (
    <button key={id} className={`btn ${klass}`} id={id} onClick={onClick} disabled={busy || disabled || !!error || readOnly}>{label}</button>
  );

  const buttons: React.ReactNode[] = [];
  if (phase === "WATCH") {
    // R-19 / R-20 · a POST BID is a decision to open; the gate and the stops
    // block it. The server refuses too — this disables the button and says why
    // rather than letting the click bounce off a 409.
    const stopped = !!stops && !stops.canOpen;
    const canPost = !!sz.reachable && !!usePx && shares > 0 && detail.session.open && !stopped;
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>price <input type="number" step="1" value={price || entryPx || ""} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>KD <input type="number" step="10" value={kdIn || (defaultKd == null ? "" : Math.round(defaultKd))} onChange={(e) => setKdIn(e.target.value)} /></label>
        <span className="hint">{shares ? `${fmt(shares)} sh · ${(shares / 1000).toFixed(2)} KD per fil` : "—"}</span>
      </div>,
      btn("btn-go-post", "go", "POST BID", () => call("Post bid", "/trading/record", { symbol, side: "BUY", status: "POSTED", priceFils: usePx, shares }), !canPost),
    );
    if (stopped) buttons.push(<span key="stopped" className="hint dn" id="detail-stopped">{stops!.mode === "cooloff" ? "no re-entry — 30 min after a loss" : stops!.mode === "careful" ? "careful — one position only" : "no new position"}: {stops!.reasons[0]}</span>);
    if (!detail.session.open) buttons.push(<span key="closed" className="hint">market closed — {detail.session.note}</span>);
    if (!sz.reachable) buttons.push(<span key="unreach" className="hint">{sz.reasons?.join(" · ") || sz.error || "not reachable at this size"}</span>);
  }
  if (phase === "QUEUED_BID" && st.postedBuy) {
    const leg = st.postedBuy;
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>filled <input type="number" placeholder={String(leg.shares)} value={filled} onChange={(e) => setFilled(e.target.value)} /></label>
        <label>executions <input type="number" placeholder="1" value={execs} onChange={(e) => setExecs(e.target.value)} /></label>
      </div>,
      btn("btn-bid-filled", "go", filled && Number(filled) < leg.shares ? "PART FILLED" : "BID FILLED", () => call("Bid filled", "/trading/resolve",
        { legId: leg.id, status: "FILLED", filledShares: filled ? Number(filled) : undefined, executions: execs ? Number(execs) : undefined })),
      btn("btn-bid-cancelled", "skip", "CANCELLED", () => call("Bid cancelled", "/trading/resolve", { legId: leg.id, status: "CANCELLED" })),
    );
  }
  if (phase === "HOLDING" && pos) {
    // The default offer: the touch, else the arm level. No placeholder — with
    // neither known the field is empty and POST OFFER is disabled.
    // R-41 · the default offer is the touch, else the +2 target — the exit rule,
    // not a trailing level. With neither known the field is empty and POST OFFER is disabled.
    const offerPx = price ? Number(price) : (book?.offer ?? pos.targetNormal ?? 0);
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>offer <input type="number" step="1" value={price || offerPx || ""} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>shares <input type="number" placeholder={String(pos.shares)} value={filled} onChange={(e) => setFilled(e.target.value)} /></label>
      </div>,
      btn("btn-post-offer", "go", "POST OFFER", () => call("Post offer", "/trading/record",
        { symbol, side: "SELL", status: "POSTED", priceFils: offerPx, shares: filled ? Number(filled) : pos.shares, seq: pos.seq }), !offerPx),
      btn("btn-get-out", "stop", "HIT THE BID", () => call("Hit the bid", "/trading/hit-bid", { symbol, executions: execs ? Number(execs) : undefined }), !detail.session.open),
    );
  }
  if (phase === "QUEUED_OFFER" && st.postedSell) {
    const leg = st.postedSell;
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>filled <input type="number" placeholder={String(leg.shares)} value={filled} onChange={(e) => setFilled(e.target.value)} /></label>
        <label>executions <input type="number" placeholder="1" value={execs} onChange={(e) => setExecs(e.target.value)} /></label>
      </div>,
      btn("btn-offer-filled", "go", filled && Number(filled) < leg.shares ? "PART FILLED" : "OFFER FILLED", () => call("Offer filled", "/trading/resolve",
        { legId: leg.id, status: "FILLED", filledShares: filled ? Number(filled) : undefined, executions: execs ? Number(execs) : undefined })),
      btn("btn-offer-cancelled", "skip", "CANCEL OFFER", () => call("Offer cancelled", "/trading/resolve", { legId: leg.id, status: "CANCELLED" })),
      // R-42 · one write, one message — cancel the resting offer and hit the bid
      // in a single transaction; a refused hit leaves the offer where it was.
      btn("btn-hit-bid-q", "stop", "CANCEL + HIT BID",
        () => call("Cancel + hit the bid", "/trading/cancel-and-hit", { symbol, executions: execs ? Number(execs) : undefined }),
        !detail.session.open),
    );
  }
  if (phase === "DONE") {
    buttons.push(<span key="done" className="hint">Flat. Another contract starts from POST BID when the board offers one — the record above is today's.</span>);
  }

  return (
    <>
      <div className={`act ${cls}`} id="act-block">
        <div className="actgrid">
          <div className="left">
            <div className="ahead">
              <span className="sym">{symbol}</span>
              <span className="px">({c?.price ?? book?.last_price ?? "—"})</span>
              {c?.market && /premier/i.test(c.market) && <span className="hint"> Premier · 0.10%</span>}
              {detail.closedToday.length > 0 && <span className="hint"> · {detail.closedToday.length} closed today</span>}
            </div>
            <div className="verb"><span className="v">{verb}</span><span className="at">{at}</span></div>
            <p className="why">{why}</p>
            {c?.careful && <p className="why hint">Careful: {c.careful}</p>}
            {error && <p className="why trade-msg bad" id="detail-stale">STALE — the last refresh failed ({(error as any).code || "error"}: {error.message}); showing the bundle fetched {detailAt ? `${ageLabel(ageSec(detailAt))} ago` : "earlier"}. Buttons are disabled.</p>}
            {msg && <p className={`why trade-msg ${msg.cls}`}>{msg.text}</p>}

            {/* R-22 · the stop, computed server-side from the aged ladder. */}
            {detail.stop && (phase === "WATCH" || phase === "HOLDING" || phase === "QUEUED_BID") && (
              <p className={`why stopline ${detail.stop.gap ? "warn" : ""} ${detail.stop.stopFils == null ? "hint" : ""}`} id="detail-stop">
                {detail.stop.stopFils != null
                  ? <>STOP <b>{detail.stop.stopFils}</b> — {detail.stop.reason}</>
                  : <>no stop: {detail.stop.reason}</>}
              </p>
            )}
            {/* R-21 · the 20-minute time stop. Hot when this position has crossed
                the clock with no favourable print — hit the bid, no auto-sell. */}
            {(() => {
              const tsList = stops?.timeStops ?? [];
              const ts = tsList.find((x) => x.symbol === symbol);
              if (!ts || (phase !== "HOLDING" && phase !== "QUEUED_OFFER")) return null;
              return (
                <p className="why trade-msg bad" id="detail-timestop">
                  TIME STOP — held <b>{ts.minutesHeld} min</b> with no move above {ts.entry}. Hit the bid{ts.bid != null ? ` (${ts.bid})` : ""}: capital in a frozen book blocks the next setup.
                </p>
              );
            })()}
            {/* R-23 · the floor is built from the aged bid; say so when the touch is bait. */}
            {sz?.basis?.bid_note && (
              <p className="why hint" id="detail-bidnote">{sz.basis.bid_note}</p>
            )}
            {phase === "WATCH" && c && (
              <div className="trio">
                <span><b>{fmt(shares || c.shares)}</b> sh</span>
                <span>net <b>{kd(c.netKd)}</b> at {c.metrics.targetTicks}t</span>
                <span>per fil <b>{(shares ? shares / 1000 : c.netPerFilKd).toFixed(2)}</b></span>
                <span>trip <b>{c.roundTripKd.toFixed(2)}</b></span>
                {sz.reachable && <span>size <b>{fmt(Math.round(sz.floor_kd))}–{fmt(Math.round(sz.ceiling_kd))}</b> KD</span>}
                {ft && <span>fill <b>{ft.label}</b> · {fmt(ft.sharesPerMin)}/min</span>}
              </div>
            )}
            {/* R-25 · today's direction from the open (FLOW step 4 checks 1-2) —
                distinct from the 5-day/1-day trend warning above. */}
            {phase === "WATCH" && c?.liveDirection && (
              <p className="why hint" id="detail-livedir">
                Today's direction (from the open):{" "}
                {c.liveDirection.computed
                  ? <>current&gt;open <b className={c.liveDirection.currentAboveOpen ? "" : "bad"}>{c.liveDirection.currentAboveOpen ? "✓" : "✗"}</b> · high&gt;open <b className={c.liveDirection.highAboveOpen ? "" : "bad"}>{c.liveDirection.highAboveOpen ? "✓" : "✗"}</b> — {c.liveDirection.note}</>
                  : c.liveDirection.note}
              </p>
            )}

            {c && (
              <div className="gates">
                {c.gateGroups.flatMap((g) => g.cells).map((cell) => (
                  <span key={cell.label} className={`g ${cell.ok ? (cell.warn ? "mid" : "ok") : "no"}`}
                    title={`${cell.label}${cell.sub ? " · " + cell.sub : ""}`}>
                    {cell.label.toLowerCase()} {cell.value}{cell.sub ? <small> {cell.sub}</small> : null}
                  </span>
                ))}
                {c.metrics.tapeQualityUpPct != null && (
                  <span className={`g ${walkedUp ? "no" : "mid"}`} title="up-only tiny prints vs the blended figure Gate 5 reads — at 2× the up-moves ARE the small prints">
                    tape up-only {Math.round(c.metrics.tapeQualityUpPct)}% / blended {Math.round(c.metrics.tapeQualityPct)}%{walkedUp ? " — walked up" : ""}
                  </span>
                )}
                {c.gateStatsSource && <span className="g mid" title="where the queue statistics came from">{c.gateStatsSource === "BACKEND_BRIDGE" ? "bridge" : "scraper"}</span>}
                {c.behaviourFlags.map((f) => <span key={f.flag} className="g no" title={f.why}>{f.icon} {f.label}</span>)}
              </div>
            )}
            {g5 && !c && null}
          </div>
          <div className="right">
            {readOnly && <span className="hint" id="detail-readonly">review — read only</span>}
            {buttons}
          </div>
        </div>
      </div>

      <div className={`lad ${ladderStale ? "stale" : ""}`} id="ladder-dom" data-stale={ladderStale ? "1" : undefined}>
        {ladderStale && (
          <div className="bk-legend stale-banner" id="ladder-stale" role="status">
            <span className="bk-legend-item dn"><b>STALE</b> — {!connected ? "socket not connected; " : ""}
              {captureAt ? `last capture ${kuwaitHHMMSS(captureAt)} Kuwait, ${ageLabel(captureAge)} ago` : "no capture time"}
              {detailAt ? ` · bundle fetched ${ageLabel(ageSec(detailAt))} ago` : ""}. Do not act on these levels.</span>
          </div>
        )}
        <div className="flow" id="book-flow">
          <span className="lab">BOOK</span>
          {book ? <>
            <span className="b">BID <b>{book.bid}</b> × {fmt(book.bid_qty)}</span>
            <span className="sep">·</span>
            <span className="s">OFFER <b>{book.offer}</b> × {fmt(book.offer_qty)}</span>
            <span className="last">last {book.last_price} · {fmt(book.trades)} trades · {hhmm(book.lastTickTime)}</span>
            {/* R-26 · the paint marker: the last move carried by a print under
                paint_max_shares is painted, not real demand. Not a gate. */}
            {detail.lastMove && detail.lastMove.painted && (
              <span className="last bad" id="book-painted" title={`the last move to ${detail.lastMove.priceFils} was carried by a ${detail.lastMove.qty}-share print`}>
                PAINTED — last move on {detail.lastMove.qty} sh (&lt; {detail.lastMove.paintMaxShares})
              </span>
            )}
            {detail.depthSignal && !detail.depthSignal.error && (
              <span className={`last ${detail.depthSignal.sampleSufficient ? "" : "hint"}`} title={detail.depthSignal.reason || ""}>
                depth {detail.depthSignal.signal}{detail.depthSignal.sampleSufficient ? "" : ` (${detail.depthSignal.snapshots} snaps — not enough to state a direction)`}
              </span>
            )}
          </> : <span className="hint">no quote for {symbol} today</span>}
        </div>
        {offers.map((l, i) => row(l, "o", i === offers.length - 1))}
        <div className="ladsplit"></div>
        {bids.map((l, i) => row(l, "b", i === 0))}
        {book && book.bids.length <= 1 && book.offers.length <= 1 && (
          <div className="bk-legend"><span className="bk-legend-item hint">only the touch — this symbol is not in the depth sweep (BOOKS tab swaps a slot)</span></div>
        )}
        {detail.legs.length > 0 && (
          <div className="bk-legend" id="legs-today">
            {detail.legs.map((l) => (
              <span key={l.id} className={`bk-legend-item ${l.status === "POSTED" ? "mine" : ""}`}>
                <span className="mk">{l.side === "BUY" ? "B" : "S"}</span>
                <span className="lbl">C{l.seq} {l.status.toLowerCase()} {fmt(l.filledShares ?? l.shares)} @ {l.price} {hhmm(l.postedAt)}{l.commissionKd != null ? ` · fee ${l.commissionKd.toFixed(3)}` : ""}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
