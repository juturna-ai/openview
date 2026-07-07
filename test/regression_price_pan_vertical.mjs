// Regression: vertical price PAN (drag up/down inside the plot body) must be
// unbounded, like TradingView.
//
// Bug: the vertical pan slid scaleMargins, which LWC clamps to [0,1] — so the
// price band stopped once a margin hit an edge (couldn't drag the content off
// past that). Fix: the pan now translates manualPriceRange by the dragged pixels
// converted to price (no [0,1] bound), preserving span (candle size unchanged).
//
// Pre-fix: repeated upward drags stall (band can't move further).
// Post-fix: each drag keeps shifting the visible mid-price → passes.
//   Run:  node test/regression_price_pan_vertical.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(11000);

// A point well inside the plot body (not the right-axis gutter).
const pt = await p.evaluate(() => {
  const el = document.getElementById('chart');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.4, yTop: r.top + r.height * 0.2, yBot: r.top + r.height * 0.8,
           cx: r.left + r.width * 0.4, cy: r.top + r.height * 0.5 };
});

// Mid visible price (price at vertical center of the plot).
const midPrice = () => p.evaluate(() => {
  const h = document.getElementById('chart').clientHeight;
  const v = candle.coordinateToPrice(h / 2);
  return v == null ? null : v;
});

const mid0 = await midPrice();
const spanOf = () => p.evaluate(() => {
  const h = document.getElementById('chart').clientHeight;
  return Math.abs(candle.coordinateToPrice(0) - candle.coordinateToPrice(h));
});
const span0 = await spanOf();

// Drag DOWN repeatedly (push content down → mid price at center rises).
let prevMid = mid0;
let monotonic = true;
for (let i = 0; i < 6; i++) {
  await p.mouse.move(pt.cx, pt.yTop);
  await p.mouse.down();
  await p.mouse.move(pt.cx, pt.yBot, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(90);
  const m = await midPrice();
  if (!(m > prevMid)) monotonic = false;   // each drag must keep moving it
  prevMid = m;
}
const midEnd = await prevMid;
const spanEnd = await spanOf();

// 1) The mid price kept shifting across all 6 drags (never stalled at an edge).
const t1 = monotonic;
// 2) Net displacement is large — far more than one clamped margin-slide could do.
const t2 = (midEnd - mid0) > span0 * 1.5;
// 3) Span (candle size) preserved within a few % — pure translation, not rescale.
const t3 = Math.abs(spanEnd - span0) / span0 < 0.05;
// 4) No app errors.
const t4 = errs.length === 0;

console.log('t1 mid price never stalled :', t1);
console.log('t2 net shift > 1.5x span   :', t2, `Δmid=${(midEnd - mid0).toFixed(1)} span=${span0.toFixed(1)}`);
console.log('t3 span preserved (no rescale):', t3, `${span0.toFixed(1)} -> ${spanEnd.toFixed(1)}`);
console.log('t4 no app errors           :', t4, errs.slice(0, 3));

await b.close();
const ok = t1 && t2 && t3 && t4;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
