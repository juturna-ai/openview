// Regression: main chart price-axis vertical drag must zoom in with NO floor.
//
// Bug: dragging the right price axis UP (compress span / zoom in) stopped at a
// floor. Two causes — (1) startAxisDrag re-based each drag from LWC's clamped
// coordinate read-back instead of the requested manualPriceRange, and (2) the MA
// / aux / main-pane indicator series reported their own data extents into the
// merged autoscale, flooring the span regardless of manualPriceRange.
//
// Fix: re-base from manualPriceRange; overlays return null from
// autoscaleInfoProvider while a manual range is active (candle/aux use candleScale).
//
// Pre-fix: span bottoms out well above the data-driven floor → fails.
// Post-fix: span compresses to a tiny fraction of the data range → passes.
//   Run:  node test/regression_price_axis_zoom.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(11000);   // let the default spread + MAs render

// Right price-axis gutter of the MAIN chart, in page coords.
const target = await p.evaluate(() => {
  const el = document.getElementById('chart');
  const r = el.getBoundingClientRect();
  let axisW = 64;
  try { const w = chart.priceScale('right').width(); if (w > 0) axisW = w; } catch (e) {}
  return {
    x: r.left + r.width - axisW / 2,
    yTop: r.top + r.height * 0.30,
    yBot: r.top + r.height * 0.80,
  };
});

// Helper: current visible price span read from the candle coordinate map.
const spanNow = () => p.evaluate(() => {
  const h = document.getElementById('chart').clientHeight;
  const top = candle.coordinateToPrice(0), bot = candle.coordinateToPrice(h);
  return (top != null && bot != null) ? Math.abs(top - bot) : null;
});

const span0 = await spanNow();

// Repeatedly drag UP (zoom in). Each pass should keep shrinking the span.
for (let i = 0; i < 6; i++) {
  await p.mouse.move(target.x, target.yBot);
  await p.mouse.down();
  await p.mouse.move(target.x, target.yTop, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(90);
}
const span1 = await spanNow();

// 1) Zoom-in kept working — span is a small fraction of where it started.
const t1 = span1 != null && span0 != null && span1 < span0 * 0.2;
// 2) manualPriceRange was set and is a tight window.
const manual = await p.evaluate(() => manualPriceRange ? (manualPriceRange.max - manualPriceRange.min) : null);
const t2 = manual != null && manual < span0 * 0.2;
// 3) No app errors thrown during the drags.
const t3 = errs.length === 0;

// Double-click axis → auto-scale restored (manualPriceRange cleared).
await p.mouse.dblclick(target.x, (target.yTop + target.yBot) / 2);
await p.waitForTimeout(300);
const cleared = await p.evaluate(() => manualPriceRange === null);
const t4 = cleared;

console.log('t1 zoom-in shrank span >5x :', t1, `${span0?.toExponential(3)} -> ${span1?.toExponential(3)}`);
console.log('t2 manual range is tight   :', t2, manual?.toExponential(3));
console.log('t3 no app errors           :', t3, errs.slice(0, 3));
console.log('t4 dblclick cleared manual :', t4);

await b.close();
const ok = t1 && t2 && t3 && t4;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
