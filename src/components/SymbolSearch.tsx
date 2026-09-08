/**
 * SymbolSearch — the ADD panel, over the board instead of a hash-generated pool.
 *
 * Every row is a StockCandidate the server screened today. There is no slot
 * cap here: watching is free; the depth SWEEP has slots and lives in BOOKS.
 */
import React, { useMemo, useState, useEffect } from "react";
import type { StockCandidate } from "../api/types";
import { fmt, kd } from "../utils/format";

interface Props { show: boolean; all: StockCandidate[]; onPick: (symbol: string) => void; onClose: () => void }

export const SymbolSearch: React.FC<Props> = ({ show, all, onPick, onClose }) => {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "recommended" | "near_miss" | "rejected">("all");
  // SPR-18 · clear the typed symbol whenever the panel closes, so it never
  // re-opens showing a stale query.
  useEffect(() => { if (!show) setQ(""); }, [show]);
  const rows = useMemo(() => {
    const t = q.trim().toUpperCase();
    return all
      .filter((s) => (filter === "all" || s.status === filter) && (!t || s.symbol.includes(t)))
      .sort((a, b) => (a.status === b.status ? b.netKd - a.netKd : ["recommended", "near_miss", "rejected"].indexOf(a.status) - ["recommended", "near_miss", "rejected"].indexOf(b.status)))
      .slice(0, 60);
  }, [all, q, filter]);
  if (!show) return null;
  return (
    <div className="addpanel show" id="add-panel">
      <div className="addhead">
        <input autoFocus placeholder="symbol…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); onClose(); } }} id="add-search" />
        {(["all", "recommended", "near_miss", "rejected"] as const).map((f) => (
          <button key={f} className={`btn ${filter === f ? "go" : "skip"}`} onClick={() => setFilter(f)}>{f.replace("_", " ")}</button>
        ))}
        <span className="hint">{all.length} screened today</span>
      </div>
      <div className="addlist">
        {rows.map((s) => (
          <div key={s.symbol} className={`pl ${s.status === "recommended" ? "go" : s.status === "near_miss" ? "open" : "no"}`} onClick={() => onPick(s.symbol)}>
            <span className="s">{s.symbol}</span><span className="p">{s.price}</span>
            <span className="w">{s.status === "recommended" ? (s.takeItBecause || "passes every gate") : s.notComputed.length ? `NOT COMPUTED: ${s.notComputed.join(", ")}` : s.failingGateNames.join(", ")}</span>
            <span className="rg">{fmt(s.shares)} sh · net {kd(s.netKd)}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="pl none">{all.length ? "no match" : "board not loaded"}</div>}
      </div>
    </div>
  );
};
