/**
 * CandleChart — the chart view (C5): GET /api/candles/:symbol for the FOCUSED
 * symbol, drawn as plain SVG. No chart library: the page is ~20 KB of markup
 * per repaint at most and the bundle stays small.
 *
 * Loud, not plausible:
 *   - no symbol           → nothing (the chart is a view OF a symbol)
 *   - loading             → "loading …" once, never a blank axis
 *   - an error            → the server's sentence, verbatim
 *   - zero candles        → "no candles for <symbol> at this grain" — an empty
 *                           chart is a statement, not a rendering failure
 * Timeframes map to the server's `minutes` (5 / 15 / 60 intraday from quote
 * captures; 1440 / 10080 are the DAY and WEEK grains from symbol_day — N-12).
 * Prices are FILS, as everywhere else on the terminal.
 */
import React, { useMemo, useState } from "react";
import { useCandles } from "../api/hooks";

export const TIMEFRAMES: { label: string; minutes: number }[] = [
  { label: "5m", minutes: 5 }, { label: "15m", minutes: 15 }, { label: "1h", minutes: 60 },
  { label: "1D", minutes: 1440 }, { label: "1W", minutes: 10080 },
];

const W = 900, H = 320, PAD = { l: 44, r: 8, t: 8, b: 22 }, VOL_H = 56;

function fmtTime(iso: string, grain: string): string {
  const d = new Date(iso);
  if (grain !== "intraday") return d.toISOString().slice(5, 10);          // MM-DD
  const k = new Date(d.getTime() + 3 * 3600_000);                          // Kuwait
  return k.toISOString().slice(11, 16);                                    // HH:MM
}

export const CandleChart: React.FC<{ symbol: string | null; date?: string | null }> = ({ symbol, date }) => {
  const [minutes, setMinutes] = useState<number>(5);
  const c = useCandles(symbol, minutes, date ?? null);
  const data = c.data;
  const rows = useMemo(() => data?.candles ?? [], [data]);

  const geo = useMemo(() => {
    if (!rows.length) return null;
    const lo = Math.min(...rows.map((r) => r.low)), hi = Math.max(...rows.map((r) => r.high));
    const span = hi - lo || 1;
    const plotH = H - PAD.t - PAD.b - VOL_H;
    const y = (p: number) => PAD.t + ((hi - p) / span) * plotH;
    const stepX = (W - PAD.l - PAD.r) / rows.length;
    const maxVol = Math.max(1, ...rows.map((r) => r.volume));
    const volY = (v: number) => H - PAD.b - (v / maxVol) * VOL_H;
    const ticks = [hi, lo + span * 0.75, lo + span * 0.5, lo + span * 0.25, lo];
    return { lo, hi, y, stepX, volY, ticks, plotBottom: PAD.t + plotH };
  }, [rows]);

  if (!symbol) return null;
  return (
    <div className="candle-chart" id="candle-chart" data-symbol={symbol} data-minutes={minutes}>
      <div className="candle-bar">
        <span className="candle-title">{symbol} · {c.data?.grain ?? "—"}</span>
        <div className="candle-tf">
          {TIMEFRAMES.map((t) => (
            <button key={t.minutes} type="button" className={`tf-btn ${minutes === t.minutes ? "on" : ""}`}
              onClick={() => setMinutes(t.minutes)} id={`tf-${t.label}`}>{t.label}</button>
          ))}
        </div>
        <span className="candle-meta">
          {c.error ? <span className="book-err">candles: {c.error.message}</span>
            : c.loading && !c.data ? "loading…"
            : rows.length === 0 ? `no candles for ${symbol} at this grain`
            : `${rows.length} candles · ${geo!.lo}–${geo!.hi} fils`}
        </span>
      </div>
      {geo && (
        <svg viewBox={`0 0 ${W} ${H}`} className="candle-svg" role="img" aria-label={`${symbol} candles`}>
          {geo.ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--line)" strokeWidth={0.5} />
              <text x={PAD.l - 4} y={geo.y(t) + 3} fontSize={9} fill="var(--dim)" textAnchor="end">{Math.round(t)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x = PAD.l + i * geo.stepX + geo.stepX / 2;
            const up = r.close >= r.open;
            const bodyW = Math.max(1, geo.stepX * 0.6);
            const top = geo.y(Math.max(r.open, r.close)), bot = geo.y(Math.min(r.open, r.close));
            const col = up ? "var(--go)" : "var(--stop)";
            return (
              <g key={r.time} className="candle" data-time={r.time}>
                <line x1={x} x2={x} y1={geo.y(r.high)} y2={geo.y(r.low)} stroke={col} strokeWidth={1} />
                <rect x={x - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bot - top)} fill={col} />
                <rect x={x - bodyW / 2} y={geo.volY(r.volume)} width={bodyW} height={H - PAD.b - geo.volY(r.volume)} fill={col} opacity={0.35} />
                {(i % Math.max(1, Math.floor(rows.length / 8)) === 0) && (
                  <text x={x} y={H - 8} fontSize={9} fill="var(--dim)" textAnchor="middle">{fmtTime(r.time, c.data?.grain ?? "intraday")}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};
