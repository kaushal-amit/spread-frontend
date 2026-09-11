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
import type { Detail, DetailLeg, TradeResult, BookLevel, SessionStops, OverridableCode, HoldFact } from "../api/types";
import { OVERRIDABLE_CODES } from "../api/types";
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

/**
 * The states the legs produce. F1 · PART FILLED is holding + the rest of the
 * buy still queued on the same leg (restStatus POSTED); a partial SELL keeps
 * QUEUED OFFER with `restingSell` naming the queued rest instead of a POSTED leg.
 */
type Phase = "WATCH" | "QUEUED_BID" | "PART_FILLED" | "HOLDING" | "QUEUED_OFFER" | "DONE";
/** A resting order: a POSTED leg, or the queued rest of a partial one. */
interface Resting { leg: DetailLeg; shares: number; rest: boolean }
const restingOf = (l: DetailLeg): Resting | null =>
  l.status === "POSTED" ? { leg: l, shares: l.shares, rest: false }
    : l.status === "FILLED" && l.restStatus === "POSTED" ? { leg: l, shares: l.restingShares ?? Math.max(0, l.shares - (l.filledShares ?? 0)), rest: true }
    : null;

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

function phaseOf(d: Detail): { phase: Phase; postedBuy?: DetailLeg; postedSell?: DetailLeg; restingBuy?: Resting; restingSell?: Resting } {
  const resting = d.legs.map(restingOf).filter((r): r is Resting => !!r);
  const restingBuy = resting.find((r) => r.leg.side === "BUY");
  const restingSell = resting.find((r) => r.leg.side === "SELL");
  const postedBuy = restingBuy && !restingBuy.rest ? restingBuy.leg : undefined;
  const postedSell = restingSell && !restingSell.rest ? restingSell.leg : undefined;
  if (d.contract && d.contract.state !== "picked") {
    if (restingSell) return { phase: "QUEUED_OFFER", postedSell, restingSell, restingBuy };
    if (restingBuy && restingBuy.rest) return { phase: "PART_FILLED", restingBuy };
    return { phase: "HOLDING", restingBuy };
  }
  if (postedBuy) return { phase: "QUEUED_BID", postedBuy, restingBuy };
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
  /** F13 · the account's realised P&L for the day (account.todayKd), for the DONE block's DAY cell. null = not known. */
  dayKd?: number | null;
  onChanged: () => void;
  onFeed: (e: { s: string; k: string; c: string; p: string; u: number }) => void;
}

/** F12 · the strip under the verdict: where this contract is on its way. */
const STEPS: { key: string; label: string }[] = [
  { key: "WATCH", label: "WATCH" }, { key: "QUEUED_BID", label: "BID" }, { key: "HOLDING", label: "FILLED" }, { key: "QUEUED_OFFER", label: "OFFER" }, { key: "DONE", label: "DONE" },
];
const stepIndex = (phase: Phase) => phase === "PART_FILLED" ? 2 : STEPS.findIndex((s) => s.key === phase);

/** F6 · one cell of the hold grid: the value, or "—" with the reason on hover. */
function Fact<T extends object>({ label, fact, value, sub, cls }: { label: string; fact: HoldFact<T> | undefined; value: (f: T) => React.ReactNode; sub?: (f: T) => React.ReactNode; cls?: (f: T) => string }) {
  if (!fact) return null;
  if (!fact.computed) {
    return (
      <div className="f" title={fact.reason} data-computed="0">
        <span className="l">{label}</span><span className="v">—</span><span className="x">{fact.reason || "not computed"}</span>
      </div>
    );
  }
  return (
    <div className={`f ${cls ? cls(fact) : ""}`} data-computed="1">
      <span className="l">{label}</span>
      <span className="v">{value(fact)}</span>
      <span className="x">{sub ? sub(fact) : null}</span>
    </div>
  );
}

export const StockDetail: React.FC<Props> = ({ symbol, detail, error, loading, detailAt, bookAt, connected, stops, readOnly = false, dayKd = null, onChanged, onFeed }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ cls: string; text: string } | null>(null);
  const [price, setPrice] = useState<string>("");
  const [kdIn, setKdIn] = useState<string>("");
  const [filled, setFilled] = useState<string>("");
  const [execs, setExecs] = useState<string>("");
  // F3 / F4 · the server refused the post with a code the operator MAY take
  // anyway. The refusal is shown, TAKE IT ANYWAY appears with a reason box, and
  // the reason goes on the leg. Plain REFUSED (structural) never offers it.
  const [overridable, setOverridable] = useState<{ code: OverridableCode; text: string; body: Record<string, unknown> } | null>(null);
  const [reason, setReason] = useState<string>("");

  const st = useMemo(() => (detail ? phaseOf(detail) : null), [detail]);
  // A message or a typed price belongs to ONE symbol. Switching tabs clears them.
  useEffect(() => { setMsg(null); setPrice(""); setKdIn(""); setFilled(""); setExecs(""); setOverridable(null); setReason(""); }, [symbol]);
  // …and to ONE phase: when the position moves on (WATCH → QUEUED_BID →
  // HOLDING → …) the price box starts empty, so the next default is the
  // phase's own (the touch offer, the target), never the previous entry.
  const phaseKey = st?.phase ?? null;
  useEffect(() => { setPrice(""); setKdIn(""); setOverridable(null); setReason(""); }, [phaseKey]);

  const call = async (label: string, path: string, body: unknown) => {
    // R-18 · review is read-only — a past-session screen must never trigger a
    // live write. The buttons are disabled, and this is the belt to that brace.
    if (readOnly) { setMsg({ cls: "bad", text: "review — read only. Select today to trade." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<TradeResult>(path, body);
      const text = [r.warning ? `Warning: ${r.warning}` : null, r.note || null,
        r.stop && r.stop.stopFils == null ? `no stop at the fill — ${r.stop.reason}` : null,
        r.commissionKnown === false ? "commission is a best case — execution count unknown" : null].filter(Boolean).join(" · ");
      setMsg({ cls: r.warning ? "warn" : "ok", text: text || `${label} recorded.` });
      onFeed({ s: symbol, k: label.toUpperCase(), c: r.warning ? "warn" : "up", p: text || `${label} recorded.`, u: 0 });
      // A typed price belongs to the ACTION it was typed for. Left in place, the
      // bid price carried over as the default OFFER after POST BID → FILLED →
      // HOLDING (POST OFFER at the entry price — the fees lost). Cleared with
      // the other inputs on every success.
      setFilled(""); setExecs(""); setPrice(""); setKdIn(""); setOverridable(null); setReason("");
      onChanged();
    } catch (e: any) {
      const ae = e as ApiError;
      const text = `${ae.code || "ERROR"}: ${ae.message}${ae.detail ? " — " + ae.detail : ""}`;
      setMsg({ cls: "bad", text });
      onFeed({ s: symbol, k: `${label.toUpperCase()} REFUSED`, c: "warn", p: text, u: 1 });
      if (ae.code && (OVERRIDABLE_CODES as readonly string[]).includes(ae.code) && body && typeof body === "object") {
        setOverridable({ code: ae.code as OverridableCode, text: ae.message, body: body as Record<string, unknown> });
      } else setOverridable(null);
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

  // F2 · STOP HIT: the bid printed through the stop recorded at the fill. Not a
  // phase — the position is still held — but it takes the verdict and the class.
  const stopHit = !!(pos && phase !== "WATCH" && phase !== "DONE" && pos.stopHitAt);
  // F5 · a position may be closed while the session is open, and in Trading at
  // Last (at the auction price). The server decides; this is its word.
  const canClose = detail.session.canClose ?? detail.session.open;
  const inTal = !!detail.session.tal || detail.session.phase === "tal";
  const holdLine = pos ? `Long ${fmt(pos.shares)} from ${pos.entry ?? "—"}. ${pos.bid == null ? "No quote today — unrealised unknown" : `Bid ${pos.bid} · ${kd(pos.unrealisedKd)} KD`}. Break-even ${pos.breakEvenPrice ?? "—"} · target ${pos.targetNormal ?? "—"} (+6 ${pos.targetTrending ?? "—"} trending)${pos.stopFils != null ? ` · stop ${pos.stopFils}` : ""}.${pos.shares !== pos.boughtShares ? ` ${fmt(pos.boughtShares - pos.shares)} already sold.` : ""}` : "";

  const verb = stopHit ? "STOP HIT"
    : phase === "WATCH" ? (c ? c.verdict.replace("_", " ") : "NO CARD")
    : phase === "QUEUED_BID" ? "QUEUED BID" : phase === "PART_FILLED" ? "PART FILLED" : phase === "HOLDING" ? (pos?.state === "carried" ? "CARRIED" : "HOLDING")
    : phase === "QUEUED_OFFER" ? "QUEUED OFFER" : "DONE";
  const cls = stopHit ? "stop" : phase === "WATCH" ? (c?.status === "recommended" ? "go" : c?.isStructuralFailure ? "stop" : "") : phase === "DONE" ? "done" : "wait";
  const at = phase === "WATCH" ? (c ? `${c.price}` : "") : phase === "QUEUED_BID" ? `${st.postedBuy?.price}` : phase === "HOLDING" || phase === "PART_FILLED" ? `${pos?.entry}` : phase === "QUEUED_OFFER" ? `${st.restingSell?.leg.price}` : kd(detail.closedToday.reduce((a, x) => a + x.netKd, 0));

  const why = stopHit && pos
    ? `The bid ${pos.bid != null ? `(${pos.bid}) ` : ""}has printed through the ${pos.stopFils} stop set at the fill. ${holdLine} Hit the bid — moving the stop is how the large losses happened.`
    : phase === "WATCH"
    ? (c ? (c.status === "recommended" ? c.takeItBecause || "passes every gate"
        : c.notComputed.length ? `NOT COMPUTED: ${c.notComputed.join(", ")}` : `${c.failingGateNames.join(", ")}${c.rejectionDetail ? " — " + c.rejectionDetail : ""}`)
        : "no row on today's board for this symbol")
    : phase === "QUEUED_BID" ? `${fmt(st.postedBuy?.shares)} resting at ${st.postedBuy?.price} since ${hhmm(st.postedBuy?.postedAt)}${ft ? ` · queue ahead ${fmt(ft.queueAheadShares)} (${ft.queueSharePct ?? "?"}% yours) · fill ${ft.label}` : ""}`
    : phase === "PART_FILLED" ? `${fmt(pos?.shares)} of ${fmt(st.restingBuy?.leg.shares)} filled at ${pos?.entry ?? "—"}; ${fmt(st.restingBuy?.shares)} still resting at ${st.restingBuy?.leg.price}. ${pos?.bid == null ? "No quote today — unrealised unknown" : `Bid ${pos.bid} · ${kd(pos.unrealisedKd)} KD`}${pos?.stopFils != null ? ` · stop ${pos.stopFils}` : ""}. Commission is per execution — two fills cost two commissions.`
    : phase === "HOLDING" ? holdLine
    : phase === "QUEUED_OFFER" ? `Selling ${fmt(st.restingSell?.shares)} at ${st.restingSell?.leg.price}${st.restingSell?.rest ? ` (the rest of a ${fmt(st.restingSell.leg.filledShares)}-share partial)` : ` since ${hhmm(st.postedSell?.postedAt)}`}. Long ${fmt(pos?.shares)} from ${pos?.entry}.`
    : detail.closedToday.map((x) => `C${x.seq}: bought ${x.entry}, sold ${x.exit}, ${fmt(x.shares)} sh, ${kd(x.netKd)} KD after ${x.feesKd.toFixed(2)} fees`).join(" · ");

  const g5 = c?.gateGroups.flatMap((g) => g.cells).find((x) => x.label === "Tape quality");
  // R-06 · the server decides walkedUp (funnel gate 5); the browser only shows it.
  const walkedUp = !!c?.metrics.walkedUp;

  // ── ladder ──
  const mine: { price: number; label: string; cls: string }[] = [];
  if (st.restingBuy) mine.push({ price: st.restingBuy.leg.price, label: st.restingBuy.rest ? `my bid · ${fmt(st.restingBuy.shares)} rest` : "my bid", cls: "mine" });
  if (st.restingSell) mine.push({ price: st.restingSell.leg.price, label: st.restingSell.rest ? `my offer · ${fmt(st.restingSell.shares)} rest` : "my offer", cls: "mine" });
  if (pos && phase !== "WATCH" && pos.entry != null) mine.push({ price: pos.entry, label: "entry", cls: "mine" });
  if (pos && phase !== "WATCH" && pos.stopFils != null) mine.push({ price: pos.stopFils, label: stopHit ? "STOP · HIT" : "stop", cls: stopHit ? "act-stop" : "mine" });
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

  // A STALE ladder disables the trade buttons: the banner says "do not act on
  // these levels" and README says the buttons are disabled when stale — they
  // were disabled only on `error`. A price typed against a picture of the book
  // from an hour ago is not a decision.
  const btn = (id: string, klass: string, label: string, onClick: () => void, disabled = false) => (
    <button key={id} className={`btn ${klass}`} id={id} onClick={onClick} disabled={busy || disabled || !!error || readOnly || ladderStale}>{label}</button>
  );

  const buttons: React.ReactNode[] = [];
  // F5 · the close button: HIT THE BID while open, CLOSE AT AUCTION PRICE in
  // Trading at Last; disabled outside both. F2 · after a STOP HIT it leads.
  const closeLabel = inTal ? "CLOSE AT AUCTION PRICE" : "HIT THE BID";
  const closeHint = !canClose ? <span key="noclose" className="hint">no close now — {detail.session.note}</span> : null;
  if (phase === "WATCH") {
    // R-19 / R-20 · a POST BID is a decision to open; the gate and the stops
    // block it. The server refuses too — this disables the button and says why
    // rather than letting the click bounce off a 409.
    // Unknown stops (null) block as hard as a STOP: a verdict that has not been
    // read is not permission. The server refuses too (R-19/R-20).
    const stopsUnknown = !stops;
    const stopped = stopsUnknown || !stops.canOpen;
    const canPost = !!sz.reachable && !!usePx && shares > 0 && detail.session.open && !stopped;
    // F3 / F4 · what the server will refuse, said BEFORE the click: a card
    // that is not TAKE, or a size outside the band it computed. The button then
    // reads TAKE IT ANYWAY and needs a reason; the server is still the judge
    // (409 OUTSIDE_SIZE_BAND / NOT_TAKE / BOARD_NOT_COMPUTED, or plain REFUSED
    // for a structural card, which nothing here can take anyway).
    const kdNow = shares && usePx ? (shares * usePx) / 1000 : null;
    const lotKd = usePx ? (usePx * 100) / 1000 : 0;
    const outsideBand = kdNow != null && sz.reachable && (kdNow < sz.floor_kd - lotKd || kdNow > sz.ceiling_kd + 0.001);
    const notTake = !!c && c.bucket !== "TAKE";
    const structural = !!c && !!c.structuralReason;
    const needsOverride = !structural && (outsideBand || notTake || !!overridable);
    const postBody = { symbol, side: "BUY", status: "POSTED", priceFils: usePx, shares };
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>price <input type="number" step="1" value={price || entryPx || ""} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>KD <input type="number" step="10" value={kdIn || (defaultKd == null ? "" : Math.round(defaultKd))} onChange={(e) => setKdIn(e.target.value)} /></label>
        <span className="hint">{shares ? `${fmt(shares)} sh · ${(shares / 1000).toFixed(2)} KD per fil` : "—"}</span>
      </div>,
    );
    if (needsOverride) {
      buttons.push(
        <p key="why-override" className="hint dn" id="detail-override-why">
          {overridable ? overridable.text
            : outsideBand ? `${fmt(Math.round(kdNow!))} KD is outside the ${fmt(Math.round(sz.floor_kd))}–${fmt(Math.round(sz.ceiling_kd))} KD band`
            : `${c!.bucket.replace(/_/g, " ")}, not TAKE${c!.failingGateNames.length ? ` — ${c!.failingGateNames.join(", ")}` : ""}`}
          . Taking it anyway is recorded as an override with your reason.
        </p>,
        <div key="reason" className="trade-inputs">
          <label>reason <input type="text" id="override-reason" placeholder="why, in your words" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>,
        btn("btn-take-anyway", "skip", "TAKE IT ANYWAY", () => call("Take it anyway", "/trading/record",
          { ...(overridable?.body ?? postBody), override: true, overrideReason: reason.trim() }), !canPost || !reason.trim()),
      );
    } else {
      buttons.push(btn("btn-go-post", "go", "POST BID", () => call("Post bid", "/trading/record", postBody), !canPost));
    }
    if (structural) buttons.push(<span key="structural" className="hint dn" id="detail-structural">{c!.structuralReason!.replace(/_/g, " ").toLowerCase()} — arithmetic, not judgement: no override</span>);
    if (stopsUnknown) buttons.push(<span key="stopped" className="hint dn" id="detail-stopped">stops unknown — the session gate has not been read; no new position until it has</span>);
    else if (stopped) buttons.push(<span key="stopped" className="hint dn" id="detail-stopped">{stops!.mode === "cooloff" ? "no re-entry — 30 min after a loss" : stops!.mode === "careful" ? "careful — one position only" : "no new position"}: {stops!.reasons[0]}</span>);
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
    if (filled && Number(filled) < leg.shares) buttons.push(<span key="parthint" className="hint">the rest ({fmt(leg.shares - Number(filled))}) stays resting on this leg — REST FILLED or CANCEL THE REST when Awsat says</span>);
  }
  // F1 · PART FILLED: the buy's rest is still queued. The two honest outcomes,
  // on the same leg — and the close, because the filled part is a position.
  if (phase === "PART_FILLED" && st.restingBuy && pos) {
    const r = st.restingBuy;
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>rest filled <input type="number" placeholder={String(r.shares)} value={filled} onChange={(e) => setFilled(e.target.value)} /></label>
        <label>executions <input type="number" placeholder="1" value={execs} onChange={(e) => setExecs(e.target.value)} /></label>
      </div>,
      btn("btn-rest-filled", "go", "REST FILLED", () => call("Rest filled", "/trading/resolve-rest",
        { legId: r.leg.id, status: "FILLED", filledShares: filled ? Number(filled) : undefined, executions: execs ? Number(execs) : undefined })),
      btn("btn-cancel-rest", "skip", "CANCEL THE REST", () => call("Rest cancelled", "/trading/resolve-rest", { legId: r.leg.id, status: "CANCELLED" })),
      <span key="parthint" className="hint">Commission is per execution — two fills cost two commissions.</span>,
      // The close is refused by the server while the bid's rest is queued (a
      // rest that fills after you are flat re-opens the contract) — so it is
      // disabled here and the hint says the order of operations.
      btn("btn-get-out", "stop", closeLabel, () => call(inTal ? "Close at the auction price" : "Hit the bid", "/trading/hit-bid", { symbol, executions: execs ? Number(execs) : undefined }), true),
      <span key="closehint" className="hint" id="detail-close-after-rest">to close: pull the rest in Awsat, CANCEL THE REST here, then {closeLabel.toLowerCase()} — the rest would re-open the contract if it filled after you were flat</span>,
    );
  }
  if (phase === "HOLDING" && pos) {
    // The default offer: the touch, else the arm level. No placeholder — with
    // neither known the field is empty and POST OFFER is disabled.
    // R-41 · the default offer is the touch, else the +2 target — the exit rule,
    // not a trailing level. With neither known the field is empty and POST OFFER is disabled.
    const offerPx = price ? Number(price) : (book?.offer ?? pos.targetNormal ?? 0);
    const close = btn("btn-get-out", "stop", closeLabel, () => call(inTal ? "Close at the auction price" : "Hit the bid", "/trading/hit-bid", { symbol, executions: execs ? Number(execs) : undefined }), !canClose);
    // F2 · after a STOP HIT the close leads; the offer is still there, second.
    if (stopHit) buttons.push(close);
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>offer <input type="number" step="1" value={price || offerPx || ""} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>shares <input type="number" placeholder={String(pos.shares)} value={filled} onChange={(e) => setFilled(e.target.value)} /></label>
      </div>,
      btn("btn-post-offer", "go", "POST OFFER", () => call("Post offer", "/trading/record",
        { symbol, side: "SELL", status: "POSTED", priceFils: offerPx, shares: filled ? Number(filled) : pos.shares, seq: pos.seq }), !offerPx || inTal),
    );
    if (!stopHit) buttons.push(close);
    if (closeHint) buttons.push(closeHint);
  }
  if (phase === "QUEUED_OFFER" && st.restingSell) {
    const r = st.restingSell;
    const leg = r.leg;
    // F1 · a POSTED offer resolves; the queued rest of a partial offer resolves
    // through resolve-rest — same buttons, the right write.
    const fillPath = r.rest ? "/trading/resolve-rest" : "/trading/resolve";
    buttons.push(
      <div key="in" className="trade-inputs">
        <label>{r.rest ? "rest filled" : "filled"} <input type="number" placeholder={String(r.shares)} value={filled} onChange={(e) => setFilled(e.target.value)} /></label>
        <label>executions <input type="number" placeholder="1" value={execs} onChange={(e) => setExecs(e.target.value)} /></label>
      </div>,
      btn("btn-offer-filled", "go", r.rest ? "REST FILLED" : (filled && Number(filled) < r.shares ? "PART FILLED" : "OFFER FILLED"), () => call(r.rest ? "Rest filled" : "Offer filled", fillPath,
        { legId: leg.id, status: "FILLED", filledShares: filled ? Number(filled) : undefined, executions: execs ? Number(execs) : undefined })),
      btn("btn-offer-cancelled", "skip", r.rest ? "CANCEL THE REST" : "CANCEL OFFER", () => call(r.rest ? "Rest cancelled" : "Offer cancelled", fillPath, { legId: leg.id, status: "CANCELLED" })),
      // R-42 · one write, one message — cancel the resting offer and hit the bid
      // in a single transaction; a refused hit leaves the offer where it was.
      btn("btn-hit-bid-q", "stop", inTal ? "CANCEL + CLOSE AT AUCTION" : "CANCEL + HIT BID",
        () => call(inTal ? "Cancel + close at the auction price" : "Cancel + hit the bid", "/trading/cancel-and-hit", { symbol, executions: execs ? Number(execs) : undefined }),
        !canClose),
    );
    if (r.rest) buttons.push(<span key="parthint" className="hint">{fmt(leg.filledShares)} of this offer filled; the rest ({fmt(r.shares)}) is still resting. Commission is per execution.</span>);
    if (closeHint) buttons.push(closeHint);
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
            {/* F2 · once open, the stop shown is the one RECORDED at the fill
                (fixedAtFill) — the WATCH line is only a preview of where it would sit. */}
            {detail.stop && phase !== "DONE" && (
              <p className={`why stopline ${detail.stop.gap || stopHit ? "warn" : ""} ${detail.stop.stopFils == null ? "hint" : ""}`} id="detail-stop" data-fixed={detail.stop.fixedAtFill ? "1" : undefined}>
                {detail.stop.stopFils != null
                  ? <>{stopHit ? <b>STOP HIT</b> : "STOP"} <b>{detail.stop.stopFils}</b> — {detail.stop.reason}{phase === "WATCH" ? " (where it would sit — fixed at the fill)" : ""}</>
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
            {/* F6 · the hold facts, one grid, from the server's holdFacts — "—"
                with the reason where a number is not known, never a zero. */}
            {detail.holdFacts && (phase === "HOLDING" || phase === "PART_FILLED" || phase === "QUEUED_OFFER") && (
              <div className="facts" id="hold-facts">
                <Fact label="MARK" fact={detail.holdFacts.mark} value={(f) => f.bidFils} sub={(f) => `${kd(f.unrealisedKd)} KD vs ${f.entryFils ?? "—"}`} cls={(f) => (f.unrealisedKd ?? 0) < 0 ? "bad" : (f.unrealisedKd ?? 0) > 0 ? "good" : ""} />
                <Fact label="BID PROTECTED" fact={detail.holdFacts.bidProtected} value={(f) => fmt(f.qty)} sub={(f) => `${f.note}${f.agedBelow ? " · aged level beneath" : " · no aged level beneath"}`} cls={(f) => f.protectedNow ? "good" : "bad"} />
                <Fact label="EXIT AT" fact={detail.holdFacts.exitAt} value={(f) => f.targetNormal} sub={(f) => `+6 ${f.targetTrending ?? "—"} · break-even ${f.breakEven ?? "—"}${f.stopFils != null ? ` · stop ${f.stopFils}` : ""}`} />
                <Fact label="VOLUME" fact={detail.holdFacts.volume} value={(f) => `${Number(f.ratio).toFixed(2)}×`} sub={(f) => f.note} cls={(f) => f.ratio < 0.5 ? "warn" : ""} />
                <Fact label="CEILING" fact={detail.holdFacts.ceiling} value={(f) => f.priceFils ?? "none"} sub={(f) => f.note} />
                <Fact label="REFILL" fact={detail.holdFacts.refill} value={() => "—"} />
                <Fact label="EXIT OK" fact={detail.holdFacts.exitOk} value={(f) => `${f.multiple}×`} sub={(f) => f.note} cls={(f) => f.ok ? "good" : "bad"} />
              </div>
            )}
            {/* F13 · the DONE block: each closed contract, and the day. */}
            {phase === "DONE" && (
              <div className="facts" id="done-facts">
                {detail.closedToday.map((x) => (
                  <React.Fragment key={x.seq}>
                    <div className="f"><span className="l">C{x.seq} BOUGHT</span><span className="v">{x.entry}</span><span className="x">{fmt(x.shares)} sh</span></div>
                    <div className="f"><span className="l">SOLD</span><span className="v">{x.exit}</span><span className="x">{x.exit - x.entry >= 0 ? "+" : ""}{x.exit - x.entry} fil{Math.abs(x.exit - x.entry) === 1 ? "" : "s"}</span></div>
                    <div className={`f ${x.netKd < 0 ? "bad" : x.netKd > 0 ? "good" : ""}`}><span className="l">NET</span><span className="v">{kd(x.netKd)}</span><span className="x">after {x.feesKd.toFixed(2)} fees</span></div>
                  </React.Fragment>
                ))}
                <div className={`f ${dayKd == null ? "" : dayKd < 0 ? "bad" : dayKd > 0 ? "good" : ""}`} title={dayKd == null ? "the account's day P&L is not loaded" : undefined}>
                  <span className="l">DAY</span><span className="v">{dayKd == null ? "—" : kd(dayKd)}</span><span className="x">{dayKd == null ? "account not loaded" : "realised, all symbols"}</span>
                </div>
              </div>
            )}
            {phase === "WATCH" && c && (
              <div className="trio">
                <span><b>{fmt(shares || c.shares)}</b> sh</span>
                <span>net <b>{kd(c.netKd)}</b> at {c.metrics.targetTicks}t</span>
                <span>per fil <b>{shares ? (shares / 1000).toFixed(2) : c.netPerFilKd != null ? c.netPerFilKd.toFixed(2) : "—"}</b></span>
                <span>trip <b>{c.roundTripKd != null ? c.roundTripKd.toFixed(2) : "—"}</b></span>
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

            {/* F12 · the progress strip: the phase is already known; this only draws it. */}
            {(() => {
              const i = stepIndex(phase);
              return (
                <>
                  <div className="prog" id="phase-progress" data-step={i}>
                    {STEPS.map((s, j) => <i key={s.key} className={j < i ? "done" : j === i ? "now" : ""}></i>)}
                  </div>
                  <div className="proglab">
                    {STEPS.map((s, j) => <span key={s.key} style={j === i ? undefined : { opacity: 0.45 }}>{j === i ? <b>{phase === "PART_FILLED" ? "PART FILLED" : stopHit ? "STOP HIT" : s.label}</b> : s.label}</span>)}
                  </div>
                </>
              );
            })()}
            {c && (
              <div className="gates">
                {c.gateGroups.flatMap((g) => g.cells).map((cell) => (
                  <span key={cell.label} className={`g ${cell.check?.computed === false ? "nc" : cell.ok ? (cell.warn ? "mid" : "ok") : "no"}`}
                    title={`${cell.label}${cell.check ? " · " + cell.check.text : cell.sub ? " · " + cell.sub : ""}`}>
                    {cell.label.toLowerCase()} {cell.value}{cell.sub ? <small> {cell.sub}</small> : null}
                    {/* CR-7 · the server's "value vs threshold — PASS/FAIL",
                        printed verbatim — the browser shows the verdict, never
                        computes it (it has neither the threshold nor the cmp). */}
                    {cell.check ? <small className="chk"> · {cell.check.text}</small> : null}
                  </span>
                ))}
                {c.metrics.tapeQualityUpPct != null && (
                  <span className={`g ${walkedUp ? "no" : "mid"}`} title="up-only tiny prints vs the blended figure Gate 5 reads — at 2× the up-moves ARE the small prints">
                    tape up-only {Math.round(c.metrics.tapeQualityUpPct)}% / blended {c.metrics.tapeQualityPct != null ? `${Math.round(c.metrics.tapeQualityPct)}%` : "—"}{walkedUp ? " — walked up" : ""}
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
