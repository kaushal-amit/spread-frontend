/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * SessionBanner — the SINGLE source for the session's trading mode (SPR-04/05).
 *
 * The mode used to arrive as transient `spread:alert` lines: one landed in the
 * pop-up banner and froze at the time it arrived, the rest piled into the feed,
 * and the two disagreed. The authoritative mode now rides every board tick as
 * `stops` (mode, canOpen, reasons). This bar reads that value directly, so it is
 * always current and — living here, above the always-mounted panel — it does
 * NOT blink out when you switch views (SPR-15). No re-arm lines: the state is
 * shown once, here.
 *
 * It is silent on a normal open day (`trade`) and before the open (`pre_open`);
 * it speaks only when the mode restricts trading.
 */
import type { SessionStops } from "../api/types";

const COPY: Record<string, { cls: string; title: string }> = {
  stop:    { cls: "danger",  title: "STOP — the day is over for new positions" },
  cooloff: { cls: "danger",  title: "NO RE-ENTRY — 30 minutes after a loss" },
  careful: { cls: "warning", title: "CAREFUL — one position at a time" },
};

export function SessionBanner({ stops }: { stops: SessionStops | null | undefined }) {
  if (!stops) return null;
  const restrictive = stops.mode === "stop" || stops.mode === "cooloff" || stops.mode === "careful";
  // A mode we don't have copy for that still blocks opening is shown plainly
  // rather than swallowed — never a silent "you may trade" when you may not.
  if (!restrictive && stops.canOpen) return null;

  const c = COPY[stops.mode] || { cls: "danger", title: stops.canOpen ? `mode: ${stops.mode}` : "no new positions" };
  const reasons = (stops.reasons && stops.reasons.length ? stops.reasons : [stops.market?.reason].filter(Boolean)) as string[];
  const cap = stops.mode === "careful" && stops.maxTargetTicks != null ? ` — take ${stops.maxTargetTicks} fils` : "";
  const until = stops.mode === "cooloff" && stops.losses?.cooloffUntil
    ? ` — until ${new Date(stops.losses.cooloffUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";

  return (
    <div className={`session-banner session-${c.cls}`} id="session-banner" role="status">
      <span className="session-banner-pip" />
      <span className="session-banner-title">{c.title}{cap}{until}</span>
      {reasons.length > 0 && <span className="session-banner-why">{reasons.join(" · ")}</span>}
      {stops.market?.breadthPct != null && (
        <span className="session-banner-breadth">breadth {stops.market.breadthPct}%{stops.market.clock ? ` · ${stops.market.clock}` : ""}</span>
      )}
    </div>
  );
}
