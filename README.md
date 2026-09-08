# SPREAD terminal

The frontend of `spread-backend` (Express + Postgres + Socket.IO on :4000). React 19,
Vite, TypeScript.

```bash
npm install
cp .env.example .env      # BACKEND_URL / SCRAPER_URL for the dev proxy; VITE_* for the browser
npm run dev               # :3000, proxies /api and /socket.io to the backend, /ingest to the scraper
npm run typecheck
npm run build             # static dist/ — put it behind the same origin as the backend, or set VITE_API_BASE
```

## What is live (Phase 2 complete — no fixture data remains)

| Surface | Source |
|---|---|
| TODAY (board, market band, open positions, free/reserve) | `/api/stocks` + `spread:update`, `/api/market`, `/api/trading/contracts`, `/api/budget` |
| Account strip (slot, equity, today, position, free, reserve, breadth, session clock) | `/api/account`, `/api/budget`, `/api/session`, `/api/market` |
| Watch-list chips | open positions + recommended + one-gate-away, from the board |
| BOOKS | `/ingest/depth-symbols` (scraper), `spread:watch` → `spread:book` |
| Ask | `/api/ai/ask` — the engine's answer or its refusal; nothing is invented on failure |
| Stock detail (action panel + ladder) | `/api/stocks/:symbol/detail` (card, book, sizing, fill time, depth signal, contract, legs) + `spread:book`; every button is a `/trading/*` write and a refusal is shown verbatim |
| ADD | a search over the board's `StockCandidate`s |
| STATES | a static reference to the state machine and the server's refusals |
| Feed | your questions, the engine's answers, and `spread:alert` / `entryAlert` / `stranded` / `wakeup` |

One socket for the app (`src/api/hooks.ts`), one typed client (`src/api/client.ts`), one set of
response types mirroring the backend's presenters (`src/api/types.ts`). No fee, gate or sizing
arithmetic runs in the browser for the live surfaces.

## Environment

The Vite proxy reads `BACKEND_URL` and `SCRAPER_URL` from `.env` via `loadEnv`. The browser sees
only `VITE_API_BASE` (empty = same origin) and `VITE_SPREAD_API_TOKEN` (the backend's shared secret;
this is a single-operator terminal — do not publish the bundle).

**Production build.** `cp .env.production.example .env.production`, set `VITE_API_BASE` to the
backend's public origin and `VITE_SPREAD_API_TOKEN` to the backend's `SPREAD_API_TOKEN`, then
`npm run build`. `.env.production` is git-ignored because the token is in it — and the built
`dist/` carries the token in its JavaScript, so the bundle is served only behind the operator's own
login or VPN, never on an open hostname. The backend README ("Production") has the reverse-proxy
rules: forward `Authorization` and `X-Forwarded-For`, proxy `/socket.io/` with the WebSocket upgrade.

## Verification (Step 4)

```bash
npm run verify          # lint (typescript-eslint + react-hooks) · vitest · tsc --noEmit · vite build
npm run capture:fixtures   # against a running backend — see below
```

`test/contracts/endpoints.test.ts` holds one contract test per endpoint. Every fixture under
`test/fixtures/*.json` was captured from the real backend by `scripts/capture-fixtures.js`
(the `_captured` block in each file says the URL, status and instant); nothing is typed by hand.
Each test assigns the captured body to its type in `src/api/types.ts` — a field that is null on
the wire but `number` in the type fails `tsc` — and `src/api/guards.ts` walks the same body at run
time. To refresh after a backend change: run the backend against `kse_test` with the fixture day
seeded, then

```bash
SPREAD_API_BASE=http://127.0.0.1:4000 SPREAD_API_TOKEN=… FIXTURE_DAY=2001-01-08 FIXTURE_SYMBOL=SZTESTABAR npm run capture:fixtures
```

What the pages do when the backend is not there: every strip tile keeps its last value and marks
it `stale` (dotted underline, "· stale" on the label, the time of the last good fetch in the
tooltip); the API chip reads `n failing · not live`; the ladder keeps its levels under a STALE
banner carrying the capture time and disables the trade buttons; a thrown render error shows the
error and a RELOAD button inside its own panel (`ErrorBoundary` around each tab, the detail page,
the feed and the strip). Every clock on screen is `Asia/Kuwait` through `Intl`
(`src/lib/time.ts`); the session date comes from `/api/session.kuwaitDay`, never from the browser.
Fonts are self-hosted (`@fontsource`, bundled) — the terminal makes no request to a third party.
