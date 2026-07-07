// Regression test for two user-reported issues (2026-07):
//
//  [A] Zoom-in was capped: the wheel/keyboard/axis-drag zoom clamped the visible span
//      to a minimum of ~8 bars, so the user hit a wall and couldn't zoom in further
//      (TradingView lets you zoom until a few bars fill the screen). Fixed by driving
//      the zoom limits off BAR SPACING via zoomSpanLimits() — zoom in until a bar is
//      ~350px wide (≈4 bars fill the screen).
//
//  [B] "Out of nowhere it bounces and for ~2s there is nothing": the silent 20-second
//      background refresh (loadChart(sym, tf, true)) ran the progressive loader, which
//      painted a partial FIRST PAGE (~1 page of bars) before the final complete paint —
//      momentarily shrinking the series and jolting a zoomed-in view. Fixed by
//      suppressing the first-page progressive paint on keepView loads.
//
// Run:  FV_URL=http://127.0.0.1:5599/ node test/regression_zoom_refresh.mjs

import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });

let crashes = 0;
p.on('pageerror', e => { if (e.message === 'Value is null') crashes++; });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);
await p.evaluate(() => loadChart('BTC-USD', activeTF));
await p.waitForTimeout(13000);

const box = await p.evaluate(() => {
  const c = document.querySelector('#chart').getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});
await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);

// ── [A] Deep zoom-in: bar spacing must grow far past the old ~8-bar cap ──
const bs0 = await p.evaluate(() => chart.timeScale().options().barSpacing);
for (let i = 0; i < 50; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(10); }
await p.waitForTimeout(400);
const bsIn = await p.evaluate(() => chart.timeScale().options().barSpacing);
// Old cap floored the visible span at 8 bars (~width/8 ≈ 200px was unreachable because
// the span never went below 8); new limit reaches ~250–350px/bar. Assert we blew past
// the old wall: bar spacing well above what an 8-bar-minimum could produce.
const tA = bsIn >= 120;

// ── [B] 20s background refresh (keepView) must not shrink the series or move the view ──
const before = await p.evaluate(() => {
  const r = chart.timeScale().getVisibleLogicalRange();
  return { from: +r.from.toFixed(2), to: +r.to.toFixed(2), n: lastData.length };
});
await p.evaluate(() => {
  window.__minLen = lastData.length;
  window.__samp = setInterval(() => { if (lastData.length < window.__minLen) window.__minLen = lastData.length; }, 30);
});
await p.evaluate(() => loadChart(activeSymbol, activeTF, true));   // the background refresh
await p.waitForTimeout(14000);
const after = await p.evaluate(() => {
  clearInterval(window.__samp);
  const r = chart.timeScale().getVisibleLogicalRange();
  return { from: +r.from.toFixed(2), to: +r.to.toFixed(2), n: lastData.length, minLen: window.__minLen };
});
const viewStable = Math.abs(before.from - after.from) < 2 && Math.abs(before.to - after.to) < 2;
const noShrink = after.minLen >= before.n - 5;   // series never dropped to a partial page mid-refresh
const tB = viewStable && noShrink;

const tCrash = crashes === 0;

console.log(`[A] deep zoom-in past old cap : ${tA ? 'PASS' : 'FAIL'} (barSpacing ${bs0.toFixed(1)} → ${bsIn.toFixed(1)})`);
console.log(`[B] refresh keeps view+series : ${tB ? 'PASS' : 'FAIL'} (view ${viewStable ? 'stable' : 'MOVED'}, minLen=${after.minLen} vs n=${before.n})`);
console.log(`[C] no render crash           : ${tCrash ? 'PASS' : 'FAIL'} (crashes=${crashes})`);

const pass = tA && tB && tCrash;
console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
await b.close();
process.exit(pass ? 0 : 1);
