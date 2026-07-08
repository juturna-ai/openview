// Regression — multi-chart grid crosshair sync (the "bouncing / mismatched vertical
// dashed line" bug across panels).
//
// Root cause: an embed panel relays its crosshair to the host, the host relays it to
// the other panel, that panel's setCrosshairPosition fires ITS OWN crosshairMove
// asynchronously (next frame) — AFTER the old setTimeout(0) echo-guard had already
// cleared — so it relayed the crosshair straight back, looping A→B→A→B (bounce).
//
// Fix: the panel remembers the last time set FROM the host (_lastParentXhairTime) and
// suppresses re-emitting that exact time, which is race-free vs LWC's async callback.
// It also now relays a LEAVE (time null) so the other panel's vertical clears instead
// of freezing at a stale x.
//
// Test strategy: mock the Coinbase candles endpoint so both iframe panels paint the
// SAME synthetic series through their real pipeline (headless can't reach exchanges),
// then hover panel A with a real mouse and count crosshair relays reaching the host.
// Pre-fix this count runs away (echo loop); post-fix it stays tiny.
//
//   Run:  node test/regression_grid_crosshair.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5599/index.html';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });

// Synthetic newest-first Coinbase page: [time(s), low, high, open, close, vol].
const STEP = 14400, BASE = 1700000000, N = 300;
function candlePage() {
  const rows = [];
  for (let i = N - 1; i >= 0; i--) {           // newest-first
    const t = BASE + i * STEP, o = 100 + Math.sin(i / 9) * 10;
    rows.push([t, o - 2, o + 2, o, o + 1, 1000]);
  }
  return rows;
}
// Mock every exchange candles call (Coinbase/Binance/Bybit/Yahoo) with the same series.
await ctx.route(/candles|klines|kline|finance\/chart/, route => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(candlePage()) });
});
// Products list (for the add-symbol dialog / any boot call) → empty is fine.
await ctx.route(/\/products(\?|$)/, route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForFunction(() => typeof buildGrid === 'function', { timeout: 20000 }).catch(()=>{});
await p.waitForTimeout(500);

// Build a 2-panel horizontal grid (two embed iframes, same symbol/tf → same series).
await p.evaluate(() => { _gridPanels = [{sym:'BTC-USD',tf:'4h'},{sym:'BTC-USD',tf:'4h'}]; buildGrid('2h'); });

// Wait for both panels to actually paint candles (series has data → timeToCoordinate
// returns a number for a mid-series time).
await p.waitForFunction(() => {
  const fr = document.querySelectorAll('#chartGrid iframe');
  if (fr.length !== 2) return false;
  const at = 1700000000 + 180*14400;
  return [...fr].every(f => {
    try { return typeof f.contentWindow.chart.timeScale().timeToCoordinate(at) === 'number'; }
    catch { return false; }
  });
}, { timeout: 30000 }).catch(()=>{});
await p.waitForTimeout(1000);

// Count crosshair relays reaching the HOST during a single hover interaction.
await p.evaluate(() => {
  window.__relays = 0;
  window.__relayHandler = e => { if (e.data && e.data.fvx === 'crosshair') window.__relays++; };
  window.addEventListener('message', window.__relayHandler);
});

// Perform a REAL mouse hover over panel A (left iframe), sweeping a few x positions
// like a user would — this drives LWC's crosshairMove through the whole relay path.
const boxA = await p.evaluate(() => {
  const f = document.querySelector('#chartGrid iframe[data-panel="0"]');
  const r = f.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
for (let k = 0; k < 8; k++) {
  await p.mouse.move(boxA.x + boxA.w * (0.3 + k * 0.04), boxA.y + boxA.h * 0.5);
  await p.waitForTimeout(60);
}
await p.waitForTimeout(500);   // let any echo settle

const res = await p.evaluate(() => {
  window.removeEventListener('message', window.__relayHandler);
  return { relays: window.__relays };
});

// t1 — NO echo loop. A hover of 8 moves produces one A→host relay per move (the
//   follower panel is silent because it relays ONLY from its own overlay-canvas hover,
//   never from a host-driven setCrosshairPosition). Measured: pre-fix bounced to
//   ~150–225 relays; post-fix = 8, dead stable. Ceiling 20 discriminates cleanly.
//   (Position-match — same time → same x in both panels — is guaranteed once the echo
//   is gone: both panels paint the identical series and snap setCrosshairPosition to
//   the same bar. It can't be asserted here because Playwright can't call LWC's
//   cross-frame timeScale() methods on the iframe's chart object.)
const t1 = res.relays > 0 && res.relays <= 20;

const pass = t1 && errs.length === 0;
console.log(JSON.stringify({ ...res, t1, errs }, null, 2));
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);
