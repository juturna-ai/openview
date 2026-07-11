// Regression — sticky price line on touch (phone UX).
//
// Stationary tap on empty plot → a dashed horizontal price line pins at that price and
// SURVIVES finger-lift. Drag starting near the line moves it. A second stationary tap
// (anywhere) dismisses it. Mouse-only desktop behavior is unchanged (no line on click).
//   Run:  node test/regression_sticky_price_line.mjs   (server on 127.0.0.1:5502)
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5502/';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ hasTouch: true, viewport: { width: 500, height: 900 }, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL + '?embed=1&sym=BTC-USD&tf=1h', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// Tap helper: real touchstart/touchend on the overlay canvas via CDP-backed touchscreen.
const tap = async (x, y) => { await p.touchscreen.tap(x, y); await p.waitForTimeout(250); };
const state = () => p.evaluate(() => ({
  line: (typeof draw !== 'undefined' && draw.stickyLine) ? { price: draw.stickyLine.price } : null,
  dragging: !!(typeof draw !== 'undefined' && draw.stickyDrag),
}));

// t1 — stationary tap creates a persistent line at that price.
await tap(200, 300);
const s1 = await state();
const t1 = !!s1.line && isFinite(s1.line.price);

// t2 — line survives (still there after idle; nothing hides it on lift).
await p.waitForTimeout(600);
const s2 = await state();
const t2 = !!s2.line;

// t3 — drag starting near the line moves it to a new price (and keeps it).
// priceToY is CANVAS-relative; CDP touch wants viewport coords — add the canvas offset.
const yOf = await p.evaluate(() => {
  if (typeof draw === 'undefined' || !draw.stickyLine) return null;
  const y = priceToY(draw.stickyLine.price);
  return y == null ? null : y + dcanvas.getBoundingClientRect().top;
});
const before = s2.line ? s2.line.price : null;
let s3 = { line: null, dragging: false };
if (yOf != null) {
  // swipe from on-the-line downward 120px
  const cds = await p.context().newCDPSession(p);
  await cds.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: yOf }] });
  for (let i = 1; i <= 6; i++)
    await cds.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: yOf + i * 20 }] });
  await cds.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(250);
  s3 = await state();
}
const t3 = !!s3.line && before != null && s3.line.price !== before && !s3.dragging;

// t4 — a second stationary tap (elsewhere) dismisses the line.
await tap(150, 250);
const s4 = await state();
const t4 = s4.line === null;

// t5 — plain MOUSE click (desktop) does NOT create a line.
await p.mouse.click(220, 320);
await p.waitForTimeout(250);
const s5 = await state();
const t5 = s5.line === null;

console.log('t1 tap creates persistent line   :', t1 ? 'PASS' : 'FAIL ' + JSON.stringify(s1));
console.log('t2 line survives finger lift     :', t2 ? 'PASS' : 'FAIL ' + JSON.stringify(s2));
console.log('t3 drag near line moves it       :', t3 ? 'PASS' : 'FAIL ' + JSON.stringify({ before, after: s3 }));
console.log('t4 second tap dismisses          :', t4 ? 'PASS' : 'FAIL ' + JSON.stringify(s4));
console.log('t5 desktop mouse click = no line :', t5 ? 'PASS' : 'FAIL ' + JSON.stringify(s5));
console.log('page errors                      :', errs.length ? errs.join(' | ') : 'none');
await b.close();
process.exit(t1 && t2 && t3 && t4 && t5 && !errs.length ? 0 : 1);
