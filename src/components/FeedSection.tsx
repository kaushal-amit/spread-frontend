import React from "react";
import { FeedEvent, ViewMode } from "../types";
import { Maximize2, Columns2 } from "lucide-react";
import { formatChatContent } from "../utils/markdown";

interface FeedSectionProps {
  headerLabel: string;
  events: FeedEvent[];
  onReadEvent?: (event: FeedEvent, index: number) => void;
  onMarkAllRead?: () => void;
  viewMode?: ViewMode;
  onToggleViewMode?: (mode: ViewMode) => void;
}

/**
 * 4.4 · one row, memoised: a new event prepends ONE row; the 399 below it do
 * not re-render. 4.6 · the key is the event's id, never the index — an index
 * key re-keys every row when one is prepended, which is the same cost as no
 * memo at all.
 */
const FeedRow = React.memo(function FeedRow({ e, index, onRead }: { e: FeedEvent; index: number; onRead?: (event: FeedEvent, index: number) => void }) {
  const isUser = e.c.includes("you") || e.k === "YOU ASKED" || e.k === "USER" || e.k === "QUESTION";
  const isAI = !isUser && (e.c.includes("reply") || e.c.includes("ai") || e.c.includes("thinking")
    || e.k === "AI ADVISOR" || e.k === "ANSWER" || e.k === "LOCAL" || e.k === "SPREAD AI");

  if (isUser) {
    return (
      <div className="chat-exchange chat-q-row" id={`feed-ev-${e.id}`}>
        <div className="chat-meta">
          <span className="chat-t">{e.t}</span>
          {e.s && e.s !== "—" && <span className="chat-s">{e.s}</span>}
        </div>
        <div className="chat-q-body" dangerouslySetInnerHTML={{ __html: formatChatContent(e.p) }} />
      </div>
    );
  }
  if (isAI) {
    return (
      <div className="chat-exchange chat-a-row" id={`feed-ev-${e.id}`}>
        <div className="chat-meta"><span className="chat-t">{e.t}</span></div>
        <div className="chat-a-body" dangerouslySetInnerHTML={{ __html: formatChatContent(e.p) }} />
      </div>
    );
  }
  const isClickable = e.s && e.s !== "—" && e.s !== "TODAY";
  return (
    <div className={`ev ${e.c} ${isClickable ? "ev-clickable" : ""}`} id={`feed-ev-${e.id}`}
      onClick={() => onRead?.(e, index)} title={isClickable ? `Focus ${e.s}` : undefined}>
      <div className="eh">
        <span className="t">{e.t}</span>
        {e.s && e.s !== "—" && <span className="s">{e.s}</span>}
        <span className="k">{e.k}</span>
      </div>
      <p dangerouslySetInnerHTML={{ __html: formatChatContent(e.p) }} />
    </div>
  );
});

export const FeedSection: React.FC<FeedSectionProps> = ({
  headerLabel,
  events,
  onReadEvent,
  viewMode = "split",
  onToggleViewMode,
}) => {
  return (
    <>
      <div className="fh" id="feed-header">
        <b id="fhl">{headerLabel}</b>

        <div className="fh-actions-right">
          {onToggleViewMode && (
            <button
              type="button"
              className="feed-expand-btn"
              onClick={() => onToggleViewMode(viewMode === "chat" ? "split" : "chat")}
              title={viewMode === "chat" ? "Switch to Split View" : "Expand to Full Screen"}
              aria-label={viewMode === "chat" ? "Switch to Split View" : "Expand to Full Screen"}
              id="btn-feed-expand"
            >
              {viewMode === "chat" ? <Columns2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
        </div>

        <hr />
      </div>

      <div id="feed">
        {events.map((e, i) => <FeedRow key={e.id} e={e} index={i} onRead={onReadEvent} />)}
      </div>
    </>
  );
};


