/**
 * src/api/socket.ts — ONE shared socket for the app.
 *
 * D3 · `auth` is a function (client.ts socketOptions), so every (re)connect
 * presents a fresh ID token. A server-side disconnect (the token's exp, after
 * spread:reauth) is "io server disconnect", which socket.io-client does NOT
 * retry by itself — reconnect explicitly.
 */
import { io, Socket } from "socket.io-client";
import { socketOptions, socketUrl } from "./client";

let shared: Socket | null = null;
export function getSocket(): Socket {
  if (!shared) {
    shared = io(socketUrl, socketOptions());
    const s = shared;
    s.on("disconnect", (reason: string) => { if (reason === "io server disconnect") setTimeout(() => s.connect(), 250); });
  }
  return shared;
}
