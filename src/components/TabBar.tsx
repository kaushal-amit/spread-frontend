/**
 * TabBar — TODAY · BOOKS · STATES, the open symbol tab, the alert banner, and
 * the live chip row (open positions, recommended, one gate away — from the
 * board). The prototype's fixture row and its "8 − n slots free" are gone.
 */
import React from "react";
import { AlertState } from "../types";

export interface LiveChip { symbol: string; price: number | null; kind: "open" | "go" | "near" }

interface TabBarProps {
  liveChips: LiveChip[] | null;
  onPickSymbol: (symbol: string) => void;
  cur: number;                    // -1 TODAY · -98 BOOKS · -99 STATES · 0 a symbol
  curSymbol: string | null;
  alert: AlertState;
  onPick: (index: number) => void;
  onClose: () => void;
  onPopGo: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({ liveChips, onPickSymbol, cur, curSymbol, alert, onPick, onClose, onPopGo }) => (
  <>
    <div className="top" id="tabbar">
      <div className={`ttab ${cur === -1 ? "on" : ""}`} id="tab-today" onClick={() => onPick(-1)}>TODAY</div>
      <div className={`ttab ${cur === -98 ? "on" : ""}`} id="tab-books" onClick={() => onPick(-98)}>BOOKS</div>
      <div className={`ttab ${cur === -99 ? "on" : ""}`} id="tab-states" onClick={() => onPick(-99)}>STATES</div>
      {curSymbol && (
        <div className="ttab on" id={`tab-${curSymbol}`}>
          {curSymbol}
          <span className="x" id={`remove-${curSymbol}`} onClick={(e) => { e.stopPropagation(); onClose(); }}>×</span>
        </div>
      )}
      <div className={`alertslot ${alert.kind} ${alert.on ? "show" : ""}`} id="alert-slot" onClick={onPopGo}>
        <span className="pip"></span>
        <span className="s">{alert.sym}</span>
        <span className="k">{alert.key}</span>
        <span className="txt">{alert.txt}</span>
        <span className="arrow">→</span>
      </div>
    </div>

    <div className="row" id="row">
      {liveChips === null && <div className="chip slotfree" id="slot-free-indicator">board loading…</div>}
      {liveChips && liveChips.length === 0 && <div className="chip slotfree" id="slot-free-indicator">nothing open, nothing recommended</div>}
      {liveChips && liveChips.filter((c) => c.symbol !== curSymbol).map((c) => (
        <div key={`live-${c.symbol}`}
          className={`chip ${c.kind === "open" ? "hot" : c.kind === "go" ? "up" : ""}`}
          id={`chip-${c.symbol}`} onClick={() => onPickSymbol(c.symbol)}
          title={c.kind === "open" ? "open position" : c.kind === "go" ? "passes every gate" : "one gate away"}>
          <span className="m"></span>
          {c.symbol}
          <span className="px">{c.price ?? "—"}</span>
        </div>
      ))}
    </div>
  </>
);
