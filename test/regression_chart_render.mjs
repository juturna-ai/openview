// Regression test for the "blank chart / bouncing zoom" bug.
//
// Root cause: loading the default spread symbol (NEAR-USD/INJ-USD) painted the
// chart once per progressive page from BOTH legs (~16 rapid full re-renders).
// On a wide-range ratio that render thrash tripped an intermittent Lightweight
// Charts race ("Value is null" inside the line renderer) which PERMANENTLY froze
// the chart's render/time-scale pipeline — candles never appeared and zoom just
// "bounced" (the time scale had stopped responding).
//
// Fix: spread symbols now paint ONCE with the complete, aligned series. Wheel
// zoom also clamps max bar-span so candles never shrink to sub-pixel slivers.
//
// This test fails on the pre-fix build (crashes > 0, chart wedged) and passes
// after the fix.  Run:  node test/regression_chart_render.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });

let crashes = 0;
p.on('pageerror', e => { if (e.message === 'Value is null') crashes++; });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(13000);   // let the default spread finish loading

const box = await p.evaluate(() => {
  const c = document.querySelector('#chart').getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});

// 1) No LWC render crash during load.
const t1 = crashes === 0;

// 2) Chart has real bars and a live series.
const bars = await p.evaluate(() => (typeof lastData !== 'undefined' && lastData) ? lastData.length : 0);
const t2 = bars > 100;

// 3) Wheel zoom actually changes bar spacing (time scale not wedged).
const bs0 = await p.evaluate(() => chart.timeScale().options().barSpacing);
await p.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5);
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(60); }
const bs1 = await p.evaluate(() => chart.timeScale().options().barSpacing);
const t3 = bs1 > bs0 + 0.5;

// 4) Full zoom-out to the loaded history (TradingView-like; sub-pixel spacing is
//    allowed by design). The regression guard is that the chart does NOT wedge:
//    the time scale stays live and responds to a subsequent zoom-in.
for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(15); }
await p.waitForTimeout(600);
const bsOut = await p.evaluate(() => chart.timeScale().options().barSpacing);
// Zoom back in and confirm bar spacing actually grows (scale not frozen at the wide edge).
await p.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5);
for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(40); }
await p.waitForTimeout(300);
const bsBack = await p.evaluate(() => chart.timeScale().options().barSpacing);
const t4 = bsBack > bsOut + 0.5;

// 5) Zooming in/out doesn't oscillate ("bounce").
await p.evaluate(() => { window.__r = []; chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) window.__r.push(+r.from.toFixed(2)); }); });
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(70); }
for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(70); }
await p.waitForTimeout(800);
const flips = await p.evaluate(() => {
  const r = window.__r; let f = 0;
  for (let i = 2; i < r.length; i++) { const d1 = r[i-1]-r[i-2], d2 = r[i]-r[i-1]; if (d1*d2 < 0 && Math.abs(d1) > 0.05 && Math.abs(d2) > 0.05) f++; }
  return f;
});
const t5 = flips <= 2;

const pass = t1 && t2 && t3 && t4 && t5;
console.log(`[1] no render crash        : ${t1 ? 'PASS' : 'FAIL'} (crashes=${crashes})`);
console.log(`[2] chart has bars         : ${t2 ? 'PASS' : 'FAIL'} (bars=${bars})`);
console.log(`[3] zoom not wedged        : ${t3 ? 'PASS' : 'FAIL'} (barSpacing ${bs0.toFixed(2)}→${bs1.toFixed(2)})`);
console.log(`[4] zoom-out not wedged    : ${t4 ? 'PASS' : 'FAIL'} (widest=${bsOut.toFixed(2)} → zoom-in=${bsBack.toFixed(2)})`);
console.log(`[5] no zoom bounce         : ${t5 ? 'PASS' : 'FAIL'} (direction flips=${flips})`);
console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');

await b.close();
process.exit(pass ? 0 : 1);
