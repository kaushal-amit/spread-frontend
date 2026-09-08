#!/usr/bin/env node
/**
 * scripts/capture-fixtures.js — capture one JSON fixture per endpoint from
 * the REAL backend, for the contract tests under test/contracts.
 *
 *   SPREAD_API_BASE=http://127.0.0.1:4000 SPREAD_API_TOKEN=… \
 *   FIXTURE_DAY=2001-01-08 FIXTURE_SYMBOL=SZTESTABAR node scripts/capture-fixtures.js
 *
 * Every file under test/fixtures/*.json is written by this script and by
 * nothing else — a fixture typed by hand tests the typist, not the backend.
 * Each capture records where it came from (url, status, when) beside the
 * body, so a stale fixture is visible in the file itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = (process.env.SPREAD_API_BASE || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TOKEN = process.env.SPREAD_API_TOKEN || '';
const DAY = process.env.FIXTURE_DAY || '';
const SYMBOL = process.env.FIXTURE_SYMBOL || '';
const OUT = path.join(__dirname, '../test/fixtures');

const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const day = q({ date: DAY });

const ENDPOINTS = [
  ['health', '/api/health'],
  ['session', '/api/session'],
  ['market', `/api/market?${day}`],
  ['budget', '/api/budget'],
  ['account', `/api/account?${day}`],
  ['stocks', `/api/stocks?${day}`],
  ['stock', `/api/stocks/${SYMBOL}?${day}`],
  ['detail', `/api/stocks/${SYMBOL}/detail?${day}`],
  ['contracts', `/api/trading/contracts?${day}`],
  ['gates', '/api/gates'],
  ['orders', `/api/orders?${q({ from: DAY, to: DAY })}`],
  ['ledger', `/api/ledger?${q({ from: DAY, to: DAY })}`],
  ['performance', `/api/performance/daily?${q({ from: DAY, to: DAY })}`],
  ['candles', `/api/candles/${SYMBOL}?${q({ date: DAY, minutes: 5 })}`],
  ['sizing', `/api/sizing/${SYMBOL}`],
  ['ai-history', `/api/ai/history?${day}`],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const [name, url] of ENDPOINTS) {
    const full = BASE + url;
    try {
      const r = await fetch(full, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = { _notJson: text.slice(0, 200) }; }
      const rec = { _captured: { url, status: r.status, at: new Date().toISOString(), day: DAY || null, symbol: SYMBOL || null }, body };
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(rec, null, 2) + '\n');
      console.log(`${r.status === 200 ? 'ok  ' : 'WARN'} ${name.padEnd(12)} ${r.status} ${url}`);
      if (r.status !== 200) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${name.padEnd(12)} ${e.message} ${url}`);
    }
  }
  console.log(failed ? `\n${failed} endpoint(s) did not answer 200 — fixtures still written with their status` : '\nall fixtures captured');
  process.exit(failed ? 1 : 0);
})();
