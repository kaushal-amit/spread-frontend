import { kuwaitHHMM } from "../lib/time";
import React, { useState } from "react";
import { FeedEvent } from "../types";
import { apiPost } from "../api/client";

interface AskBarProps {
  /** The symbol in focus, or null on TODAY. */
  curSymbol: string | null;
  onAddFeedEvent: (event: FeedEvent) => void;
  onUpdateThinkingEvent?: (content: { k: string; c: string; p: string }) => void;
}

export const AskBar: React.FC<AskBarProps> = ({ curSymbol, onAddFeedEvent }) => {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);


  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = question.trim();
    if (!v || asking) return;

    const sym = curSymbol || "TODAY";
    const now = kuwaitHHMM(Date.now());

    setAsking(true);
    setQuestion("");

    // Add user question to feed
    onAddFeedEvent({
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      t: now,
      s: sym,
      k: "QUESTION",
      c: "you",
      u: 0,
      p: v,
    });

    try {
      /*
       * C-04 · THE REAL ENDPOINT, AND NO FABRICATED FALLBACK.
       *
       * This posted to /api/ask (the route is /api/ai/ask), read `answer` (the
       * field is `text`), and on the resulting 404 fell into a keyword-matched
       * canned reply styled exactly like a real one. A fabricated trading answer
       * with no indicator was the most dangerous thing on the screen. Now: the
       * engine's text when ok, its refusal when not, and a visible error when
       * the call fails. Nothing is invented here.
       */
      const data = await apiPost<{ text: string; ok: boolean; source: string }>("/ai/ask", {
        symbol: curSymbol || undefined,
        question: v,
      });
      onAddFeedEvent({
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        t: kuwaitHHMM(Date.now()),
        s: sym,
        k: data.ok ? "ANSWER" : "REFUSED",
        c: data.ok ? "reply" : "warn",
        u: 0,
        p: data.ok ? data.text : `The engine refused this one (${data.source}): ${data.text}`,
      });
    } catch (err: any) {
      onAddFeedEvent({
        id: `ai-err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        t: kuwaitHHMM(Date.now()),
        s: sym,
        k: "ENGINE UNAVAILABLE",
        c: "warn",
        u: 1,
        p: `No answer — ${err?.code ? err.code + ": " : ""}${err?.message || "request failed"}. Nothing was invented in its place.`,
      });
    } finally {
      setAsking(false);
    }
  };

  const placeholderText = curSymbol
    ? `Ask the engine about ${curSymbol} (gates, book, exit)…`
    : "Ask the engine about breadth, the board, or a rule…";

  return (
    <form className="ask" onSubmit={handleAsk} id="ask-form">
      <input
        id="q"
        placeholder={placeholderText}
        aria-label="Ask AI Assistant"
        autoComplete="off"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        disabled={asking}
      />
      <button type="submit" id="ask-btn" disabled={asking || !question.trim()}>
        {asking ? "..." : "ASK"}
      </button>
    </form>
  );
};
