// Regression test for "RSI pane price axis cannot be dragged/zoomed".
//
// The RSI sub-pane pinned its price scale to a hardcoded 18–82 window via an
// autoscaleInfoProvider that ignored any user input, and had no drag handler —
// so unlike the main chart, dragging its right price-axis gutter did nothing.
//
// Fix: manualRsiRange + rsiScale honoring it + a vertical-drag handler on the
// RSI pane's axis gutter (mirrors the main chart's axis stretch). Drag DOWN
// expands the range (zoom out); double-click the axis resets to 18–82.
//
// Pre-fix: manualRsiRange is undefined and the drag is a no-op → fails.
// Post-fix: the drag sets manualRsiRange and widens the span → passes.
//   Run:  node test/regression_rsi_axis_drag.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(9000);   // let data + RSI pane render

// Locate the RSI pane's right price-axis gutter in page coords.
const target = await p.evaluate(() => {
  const el = document.getElementById('rsi');
  const r = el.getBoundingClientRect();
  let axisW = 64;
  try { const w = rsiChart.priceScale('right').width(); if (w > 0) axisW = w; } catch (e) {}
  return {
    x: r.left + r.width - axisW / 2,   // middle of the axis gutter
    yTop: r.top + r.height * 0.35,
    yBot: r.top + r.height * 0.85,
    hasVar: typeof manualRsiRange !== 'undefined',
  };
});

// 1) The manual-range state exists (undefined on the pre-fix build).
const t1 = target.hasVar;

const spanBefore = await p.evaluate(() => {
  const r = rsiScale().priceRange; return r.maxValue - r.minValue;
});

// Simulate a downward drag on the axis gutter (should expand the range).
await p.mouse.move(target.x, target.yTop);
await p.mouse.down();
await p.mouse.move(target.x, target.yBot, { steps: 12 });
await p.mouse.up();
await p.waitForTimeout(300);

const after = await p.evaluate(() => ({
  manual: (typeof manualRsiRange !== 'undefined') ? manualRsiRange : null,
  span: (() => { const r = rsiScale().priceRange; return r.maxValue - r.minValue; })(),
}));

// 2) Drag set a manual range.
const t2 = after.manual != null;
// 3) Dragging DOWN expanded the visible RSI span (zoom out).
const t3 = after.span > spanBefore + 1e-6;

// 3b) Zoom IN with no floor: repeated upward drags should compress the span
// well below the old ~40-wide (30–70) autoscale floor.
for (let i = 0; i < 4; i++) {
  await p.mouse.move(target.x, target.yBot);
  await p.mouse.down();
  await p.mouse.move(target.x, target.yTop, { steps: 10 });   // drag UP = zoom in
  await p.mouse.up();
  await p.waitForTimeout(80);
}
const zoomedIn = await p.evaluate(() => { const r = rsiScale().priceRange; return r.maxValue - r.minValue; });
const t3b = zoomedIn < 10;   // far below the pre-fix 30–70 floor

// 3c) Hover the axis gutter (no button) → cursor becomes ns-resize.
await p.mouse.move(target.x - 2, (target.yTop + target.yBot) / 2);
await p.waitForTimeout(120);
// Hover hint is now class-based (#rsi.axis-hover) — the LWC canvas overrides inline cursors.
const cursor = await p.evaluate(() => {
  const el = document.getElementById('rsi');
  return el.classList.contains('axis-hover') ? 'ns-resize' : el.style.cursor;
});
const t3c = cursor === 'ns-resize';

// Double-click the axis → reset to default 18–82.
await p.mouse.dblclick(target.x, (target.yTop + target.yBot) / 2);
await p.waitForTimeout(200);
const reset = await p.evaluate(() => ({
  manual: (typeof manualRsiRange !== 'undefined') ? manualRsiRange : 'x',
  span: (() => { const r = rsiScale().priceRange; return r.maxValue - r.minValue; })(),
}));
// 4) Reset cleared the manual range back to the 64-wide default (82-18).
const t4 = reset.manual === null && Math.abs(reset.span - 64) < 1e-6;

console.log('t1  manualRsiRange exists  :', t1);
console.log('t2  drag set manual range  :', t2, after.manual);
console.log('t3  drag DOWN expanded     :', t3, `${spanBefore.toFixed(2)} -> ${after.span.toFixed(2)}`);
console.log('t3b zoom IN past 30-70 floor:', t3b, `span=${zoomedIn.toFixed(3)}`);
console.log('t3c hover cursor ns-resize :', t3c, `cursor="${cursor}"`);
console.log('t4  dblclick reset to 18-82:', t4, reset.span.toFixed(2));

await b.close();
const ok = t1 && t2 && t3 && t3b && t3c && t4;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
