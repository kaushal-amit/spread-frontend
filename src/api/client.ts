/**
 * src/api/client.ts — ONE way to reach the backend.
 *
 * The base URL comes from the environment (VITE_API_BASE), so a static build
 * works behind a reverse proxy and the dev server works through the Vite
 * proxy with it left blank. The credential is the signed-in user's Firebase
 * ID token (src/auth.ts) — D3: no static token is compiled into this bundle
 * any more. Every failure is an ApiError carrying the backend's code — never
 * swallowed into an empty list. An empty list and a failed fetch render
 * identically and only one of them is information.
 */
import { idToken, configured as authConfigured } from '../auth';

export class ApiError extends Error {
  status: number; code: string; detail: string | null;
  /** D3 · the backend's auth reason (NO_TOKEN, TOKEN_EXPIRED, UID_NOT_ALLOWED, …) when it sent one. */
  reason: string | null;
  constructor(status: number, code: string, message: string, detail: string | null = null, reason: string | null = null) {
    super(message); this.status = status; this.code = code; this.detail = detail; this.reason = reason;
  }
}

/**
 * A 403 UID_NOT_ALLOWED is not a request's problem — it is the session's.
 * Broadcast once so the sign-in gate can show the sentence and a sign-out,
 * instead of every panel printing the same 403.
 */
export const AUTH_REFUSED_EVENT = 'spread:auth-refused';

const trimBase = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\/$/, '') : '');

export const API_BASE: string = trimBase(import.meta.env.VITE_API_BASE);

/**
 * D2 · fail LOUD when a production build has no backend base. The silent
 * same-origin fallback is what shipped the wss://kse-spread socket bug and the
 * whole-board 404s: a static build MUST be told where the backend is. Surfaced
 * to the console at load and via `configError` so the app can show a banner
 * instead of silently calling its own origin.
 */
export const configError: string | null =
  import.meta.env.PROD && !API_BASE
    ? 'VITE_API_BASE is not set — this build has no backend URL and is calling its own origin. Rebuild with VITE_API_BASE pointed at the backend.'
    : import.meta.env.PROD && !authConfigured
      ? 'VITE_FIREBASE_API_KEY / VITE_FIREBASE_AUTH_DOMAIN / VITE_FIREBASE_PROJECT_ID are not set — this build cannot sign in, so every request will be refused. Rebuild with the Firebase web config.'
      : null;
if (configError) console.error('[SPREAD config] ' + configError);

// D3 · the credential is the signed-in user's ID token, fetched per request
// (the SDK caches it and refreshes before expiry). `force` after a
// TOKEN_EXPIRED. No token → no header: the server names the refusal.
async function headers(json = false, force = false): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = await idToken(force);
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function parse<T>(r: Response): Promise<T> {
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!r.ok) {
    const err = new ApiError(r.status, body?.code || `HTTP_${r.status}`,
      body?.error || (text && text.length < 200 ? text : r.statusText) || `HTTP ${r.status}`, body?.detail ?? null,
      typeof body?.reason === 'string' ? body.reason : null);
    if (err.status === 403 && err.reason === 'UID_NOT_ALLOWED' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_REFUSED_EVENT, { detail: { message: err.message, reason: err.reason } }));
    }
    throw err;
  }
  return body as T;
}

/**
 * One retry, and only for TOKEN_EXPIRED: the SDK refreshes the token before
 * expiry, but a tab that slept past it wakes with a stale one. Any other
 * refusal is reported as it is.
 */
async function withRetry<T>(run: (force: boolean) => Promise<T>): Promise<T> {
  try { return await run(false); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.reason === 'TOKEN_EXPIRED') return run(true);
    throw e;
  }
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
  if (ext?.aborted) {
    // Already cancelled (the caller unmounted while the token was being read):
    // nothing to fetch. The same AbortError a live cancel produces.
    clearTimeout(to);
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  }
  if (ext) ext.addEventListener('abort', onExtAbort, { once: true });
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
  return withRetry(async (force) => {
    const r = await doFetch(`${API_BASE}/api${path}${qs.length > 1 ? qs : ''}`, { headers: await headers(false, force) }, o);
    return parse<T>(r);
  });
}

export async function apiPost<T>(path: string, body: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST', opts?: ReqOpts): Promise<T> {
  const o = { ...opts, timeoutMs: opts?.timeoutMs ?? timeoutFor(path) };
  return withRetry(async (force) => {
    const r = await doFetch(`${API_BASE}/api${path}`, { method, headers: await headers(true, force), body: JSON.stringify(body ?? {}) }, o);
    return parse<T>(r);
  });
}

/**
 * The socket connects to the same origin as the API, with the same credential.
 * D3 · `auth` is a FUNCTION: socket.io-client calls it on every (re)connect, so
 * the handshake carries a fresh ID token. The server disconnects a user socket
 * at the token's exp (after `spread:reauth`); getSocket() reconnects, this
 * function runs again, and the watches are re-sent on connect.
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
  auth: (cb: (data: Record<string, string>) => void) => { idToken().then((t) => cb(t ? { token: t } : {})).catch(() => cb({})); },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 8000,
  timeout: 8000,
});
export const socketUrl = API_BASE || undefined;
