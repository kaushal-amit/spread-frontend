/**
 * src/api/client.ts — ONE way to reach the backend.
 *
 * Base URL and token come from the environment (VITE_API_BASE,
 * VITE_SPREAD_API_TOKEN), so a static build works behind a reverse proxy and
 * the dev server works through the Vite proxy with both left blank. Every
 * failure is an ApiError carrying the backend's code — never swallowed into an
 * empty list. An empty list and a failed fetch render identically and only one
 * of them is information.
 */
export class ApiError extends Error {
  status: number; code: string; detail: string | null;
  constructor(status: number, code: string, message: string, detail: string | null = null) {
    super(message); this.status = status; this.code = code; this.detail = detail;
  }
}

const trimBase = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\/$/, '') : '');

export const API_BASE: string = trimBase(import.meta.env.VITE_API_BASE);
export const API_TOKEN: string | null = (import.meta.env.VITE_SPREAD_API_TOKEN as string | undefined)?.trim() || null;

/**
 * The scraper's ingest token is a SEPARATE secret (VITE_INGEST_TOKEN). The
 * backend token used to be sent to the scraper as well, which meant one value
 * — compiled into this public bundle — could also write orders, quotes and
 * depth and swap the slots on the scraper. With no VITE_INGEST_TOKEN the
 * scraper calls carry no token and answer 401, which BOOKS shows as an error:
 * loud, never a silent fallback to the backend token.
 */
export const INGEST_TOKEN: string | null = (import.meta.env.VITE_INGEST_TOKEN as string | undefined)?.trim() || null;

/**
 * The scraper owns /ingest (capture config + the depth slots); the backend owns
 * /api. In dev, Vite proxies both, so INGEST_BASE is blank. In a static build
 * there is no proxy — /ingest must be pointed at the scraper's origin, or the
 * request hits the SPA host (Firebase), gets index.html back with a 200, and the
 * "book" reads as a null response. Defaults to VITE_INGEST_BASE, then API_BASE
 * (when the backend reverse-proxies /ingest), then same-origin.
 */
export const INGEST_BASE: string = trimBase(import.meta.env.VITE_INGEST_BASE) || API_BASE;

/**
 * D2 · fail LOUD when a production build has no backend base. The silent
 * same-origin fallback is what shipped the wss://kse-spread socket bug and the
 * whole-board 404s: a static build MUST be told where the backend is. Surfaced
 * to the console at load and via `configError` so the app can show a banner
 * instead of silently calling its own origin.
 */
export const configError: string | null =
  import.meta.env.PROD && !API_BASE
    ? 'VITE_API_BASE is not set — this build has no backend URL and is calling its own origin. Rebuild with VITE_API_BASE (and VITE_INGEST_BASE) pointed at the backend/scraper.'
    : import.meta.env.PROD && !INGEST_TOKEN
      ? 'VITE_INGEST_TOKEN is not set — BOOKS cannot read the depth slots or swap them (the scraper answers 401). Rebuild with the scraper\'s INGEST_TOKEN.'
      : null;
if (configError) console.error('[SPREAD config] ' + configError);

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`;
  return h;
}

async function parse<T>(r: Response): Promise<T> {
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!r.ok) {
    throw new ApiError(r.status, body?.code || `HTTP_${r.status}`,
      body?.error || (text && text.length < 200 ? text : r.statusText) || `HTTP ${r.status}`, body?.detail ?? null);
  }
  return body as T;
}

/**
 * Per-request controls. `signal` lets a caller (a hook effect) cancel a request
 * on unmount or when its inputs change — without it, a slow response resolves
 * after a newer one and overwrites fresh state (an out-of-order race). `timeoutMs`
 * bounds a hung connection: a backend that accepts the socket but never answers
 * would otherwise leave the request pending forever, stalling a poll loop or
 * locking a form. Both default sensibly; callers rarely pass either.
 */
export interface ReqOpts { signal?: AbortSignal; timeoutMs?: number; }
// Per-endpoint timeouts live in ONE config module (config/endpoints.ts), not as
// a literal here. DEFAULT_TIMEOUT_MS stays exported for callers that want the
// baseline explicitly; apiGet/apiPost resolve the per-path value from it.
import { timeoutFor, TIMEOUT_MS } from '../config/endpoints';
export const DEFAULT_TIMEOUT_MS = TIMEOUT_MS.default;

async function doFetch(url: string, init: RequestInit, opts?: ReqOpts): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const to = setTimeout(() => { timedOut = true; ctrl.abort(); }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // Fold an external abort (a hook cleaning up, or its params changing) into the
  // request's own controller, so cancellation works whichever side triggers it.
  const ext = opts?.signal;
  const onExtAbort = () => ctrl.abort();
  if (ext) { if (ext.aborted) ctrl.abort(); else ext.addEventListener('abort', onExtAbort, { once: true }); }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    // A timeout is a real, reportable error; an external cancel is not (the
    // caller no longer wants the answer) and is re-thrown as an AbortError for
    // the hook to ignore; anything else is a network failure, reported without
    // leaking the raw fetch message.
    if (timedOut) throw new ApiError(408, 'TIMEOUT', 'the request timed out');
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'could not reach the server');
  } finally {
    clearTimeout(to);
    if (ext) ext.removeEventListener('abort', onExtAbort);
  }
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>, opts?: ReqOpts): Promise<T> {
  const qs = params
    ? '?' + Object.entries(params).filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const o = { ...opts, timeoutMs: opts?.timeoutMs ?? timeoutFor(path) };
  const r = await doFetch(`${API_BASE}/api${path}${qs.length > 1 ? qs : ''}`, { headers: headers() }, o);
  return parse<T>(r);
}

export async function apiPost<T>(path: string, body: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST', opts?: ReqOpts): Promise<T> {
  const o = { ...opts, timeoutMs: opts?.timeoutMs ?? timeoutFor(path) };
  const r = await doFetch(`${API_BASE}/api${path}`, { method, headers: headers(true), body: JSON.stringify(body ?? {}) }, o);
  return parse<T>(r);
}

/**
 * The socket connects to the same origin as the API, with the same secret.
 *
 * SPR-33 · reconnection is made EXPLICIT: a push channel that dropped (or never
 * attached) on load must keep trying, forever, with backoff — a silent gap that
 * leaves the page reading "live" on stale data is the failure this system
 * produces most. The UI shows the disconnection (App's connection banner); this
 * is the machinery that heals it.
 */
export const socketOptions = () => ({
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  auth: API_TOKEN ? { token: API_TOKEN } : {},
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  timeout: 8000,
});
export const socketUrl = API_BASE || undefined;
