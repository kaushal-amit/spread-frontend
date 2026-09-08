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

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
export const API_TOKEN: string | null = (import.meta.env.VITE_SPREAD_API_TOKEN as string | undefined) || null;

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

export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = params
    ? '?' + Object.entries(params).filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  const r = await fetch(`${API_BASE}/api${path}${qs.length > 1 ? qs : ''}`, { headers: headers() });
  return parse<T>(r);
}

export async function apiPost<T>(path: string, body: unknown, method: 'POST' | 'PUT' | 'DELETE' = 'POST'): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, { method, headers: headers(true), body: JSON.stringify(body ?? {}) });
  return parse<T>(r);
}

/** The socket connects to the same origin as the API, with the same secret. */
export const socketOptions = () => ({
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  auth: API_TOKEN ? { token: API_TOKEN } : {},
});
export const socketUrl = API_BASE || undefined;
