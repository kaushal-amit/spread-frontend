/**
 * SymbolSearch — the ADD panel, over the board instead of a hash-generated pool.
 *
 * Every row is a StockCandidate the server screened today. There is no slot
 * cap here: watching is free; the depth SWEEP has slots and lives in BOOKS.
 *
 * F14 · the filters are the SAME seven screener chips TODAY uses
 * (lib/screener.ts): one set of predicates, one set of labels, so the two
 * panels never disagree about what "passes every gate" or "reachable" means.
 * The rows sort by bucket (TAKE first) then by known net, an unknown net last.
 */
import React, { useMemo, useState, useEffect } from "react";
import type { StockCandidate } from "../api/types";
import { fmt, kd } from "../utils/format";
import { SCREENER_FILTERS, screenerLabel, applyScreener, type ScreenerKey } from "../lib/screener";

interface Props { show: boolean; all: StockCandidate[]; budgetKd?: number | null; onPick: (symbol: string) => void; onClose: () => void }

const BUCKET_ORDER = ["TAKE", "ONE_AWAY", "PRICE_WARN", "LEAVE", "NOT_COMPUTED"];
const bucketOf = (s: StockCandidate) => s.bucket ?? ({ recommended: "TAKE", near_miss: "ONE_AWAY", price_warn: "PRICE_WARN", rejected: "LEAVE", not_computed: "NOT_COMPUTED" } as const)[s.status];

export const SymbolSearch: React.FC<Props> = ({ show, all, budgetKd = null, onPick, onClose }) => {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ScreenerKey>("ALL");
  // SPR-18 · clear the typed symbol whenever the panel closes, so it never
  // re-opens showing a stale query.
  useEffect(() => { if (!show) { setQ(""); setFilter("ALL"); } }, [show]);
  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    return applyScreener(all, filter)
      .filter((s) => !t || s.symbol.includes(t))
      // Within a bucket, known net first (descending); an unknown net sorts last, not as 0.
      .sort((a, b) => {
        const ba = BUCKET_ORDER.indexOf(bucketOf(a)), bb = BUCKET_ORDER.indexOf(bucketOf(b));
        return ba === bb ? (b.netKd ?? -Infinity) - (a.netKd ?? -Infinity) : ba - bb;
      })
      .slice(0, 60);
  }, [all, q, filter]);
  const matched = useMemo(() => applyScreener(all, filter).length, [all, filter]);
  if (!show) return null;
  return (
    <div className="addpanel show" id="add-panel">
      <div className="addhead">
        <input autoFocus placeholder="symbol…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); onClose(); } }} id="add-search" />
        <span className="hint" id="add-summary-count">{filter === "ALL" ? `${all.length} screened today` : `${matched} of ${all.length}`}</span>
      </div>
      <div className="scrn" id="add-filters" role="group" aria-label="add-panel filters">
        {SCREENER_FILTERS.map((def) => (
          <button key={def.key} type="button" id={`add-filter-${def.key}`} className={`chip ${filter === def.key ? "on" : ""}`}
            aria-pressed={filter === def.key} onClick={() => setFilter(def.key)}>
            {screenerLabel(def, budgetKd)}
          </button>
        ))}
      </div>
      <div className="addlist">
        {rows.map((s) => (
          <div key={s.symbol} className={`pl ${bucketOf(s) === "TAKE" ? "go" : bucketOf(s) === "ONE_AWAY" || bucketOf(s) === "PRICE_WARN" ? "open" : "no"}`} data-bucket={bucketOf(s)} onClick={() => onPick(s.symbol)}>
            <span className="s">{s.symbol}{s.wakeup ? <b className="wake-badge"> {s.wakeup.paceRatio}×</b> : null}</span><span className="p">{s.price ?? "—"}</span>
            <span className="w">{bucketOf(s) === "TAKE" ? (s.takeItBecause || "passes every gate") : s.notComputed.length && !s.failingGateNames.filter((g) => !s.notComputed.includes(g)).length ? `NOT COMPUTED: ${s.notComputed.join(", ")}` : s.failingGateNames.join(", ")}</span>
            <span className="rg">{fmt(s.shares)} sh · net {kd(s.netKd)}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="pl none">{all.length ? (filter === "ALL" ? "no match" : "nothing passes this filter") : "board not loaded"}</div>}
      </div>
    </div>
  );
};
