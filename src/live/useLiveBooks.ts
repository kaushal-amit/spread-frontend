import { useEffect, useRef, useState } from "react";
import { Book, Slot } from "./api";
import { getSocket } from "../api/socket";
import { useSnapshotState, isSectionError, bootstrap, type SlotList } from "../api/snapshot";

/**
 * src/live/useLiveBooks.ts — five books, pushed.
 *
 * ─── THE SOCKET, NOT THE DATED ROUTE ───────────────────────────────────────
 * /api/review/session/:date/book/:symbol exists and is read-only by design —
 * it serves REVIEW mode. Feeding a live screen from it would blur the boundary
 * that stops a review screen triggering a live action.
 *
 * So: the slot list comes from the snapshot's `slots` section (the socket
 * plan — pushed a minute, and as a partial right after a swap), then every
 * book from the `spread:book` push, which the server sends ON CHANGE for the
 * watched symbols — a tile that stops receiving is a tile whose capture
 * stopped, which is the truth.
 */
export function useLiveBooks() {
  const [slots, setSlots] = useState<Slot[]>([]);
  // The scraper's slot count — null until the list arrives, never a guess.
  const [slotCount, setSlotCount] = useState<number | null>(null);
  const [books, setBooks] = useState<Record<string, Book>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watched = useRef<Set<string>>(new Set());

  /*
   * C-06 · THE SERVER PUSHES ONLY WHAT IS WATCHED.
   *
   * socket.js emits `spread:book` for watchedSymbols(), which is filled solely
   * by a client `spread:watch`. This hook never sent one, so five tiles read
   * "no book captured yet" forever under a header that said live. Every slot
   * is watched as soon as the slot list arrives, and unwatched when it leaves.
   */
  const watch = (symbols: string[]) => {
    const s = getSocket();
    const next = new Set(symbols.filter(Boolean).map((x) => x.toUpperCase()));
    for (const sym of watched.current) if (!next.has(sym)) s.emit("spread:unwatch", { symbol: sym });
    for (const sym of next) if (!watched.current.has(sym)) s.emit("spread:watch", { symbol: sym });
    watched.current = next;
  };

  // The slot list is a SECTION of the snapshot: no fetch, no 30 s loop. An
  // error in that section is shown as the slots error (the scraper unreachable
  // or unconfigured), never a silent empty list.
  const st = useSnapshotState();
  const slotsRaw = st.sections.slots;
  useEffect(() => {
    if (slotsRaw === undefined) return;
    if (isSectionError(slotsRaw)) { setError(slotsRaw.error.error); return; }
    const r = slotsRaw as SlotList;
    const list = r?.symbols || [];
    setSlots(list);
    setSlotCount(typeof r?.slotCount === "number" && r.slotCount > 0 ? r.slotCount : null);
    watch(list.map((x) => x.symbol));
    setError(null);
     
  }, [slotsRaw]);
  // After a swap the backend announces a `slots` partial within 5 s; a
  // bootstrap fetches the same object now, for the tile that just asked.
  const reloadSlots = async () => { await bootstrap("slots"); };

  useEffect(() => {
    // ONE shared socket for the app (api/socket.ts) — this used to open its own
    // and close it on every tab switch.
    const s = getSocket();
    // On (re)connect the server's watch set is empty (it is keyed by socket.id):
    // every slot is re-watched OUTRIGHT. `watch()` diffs against watched.current
    // and so emitted nothing here — BOOKS went silent after every reconnect.
    const onConnect = () => {
      setConnected(true);
      for (const sym of watched.current) s.emit("spread:watch", { symbol: sym });
    };
    const onDisconnect = () => setConnected(false);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    if (s.connected) setConnected(true);

    /**
     * The book travels with the symbol.
     *
     * `symbol` alone was a refetch signal and the contract forbids it — a
     * refetch defeats in-place updating. `book` is additive, so an older
     * consumer still works.
     */
    const onBook = (msg: any) => {
      if (!msg?.symbol) return;
      // A null book after a swap CLEARS the tile; it used to leave the old
      // symbol's ladder in place.
      if (!msg.book) { setBooks((prev) => { const n = { ...prev }; delete n[msg.symbol]; return n; }); return; }
      setBooks((prev) => ({
        ...prev,
        [msg.symbol]: {
          symbol: msg.symbol,
          capturedAt: msg.book.capturedAt ?? null,
          bids: (msg.book.b || []).map((l: any[]) => ({
            price: l[0], qty: l[1], orders: l[2] ?? null,
          })),
          offers: (msg.book.o || []).map((l: any[]) => ({
            price: l[0], qty: l[1], orders: l[2] ?? null,
          })),
          // The server does not send a snapshot count; null, not a fake 0.
          snapshots: msg.book.snapshots ?? null,
        },
      }));
    };
    s.on("spread:book", onBook);

    return () => {
      s.off("spread:book", onBook); s.off("connect", onConnect); s.off("disconnect", onDisconnect);
      for (const sym of watched.current) s.emit("spread:unwatch", { symbol: sym });
      watched.current = new Set();
    };
     
  }, []);

  return { slots, slotCount, books, connected, error, reloadSlots };
}
