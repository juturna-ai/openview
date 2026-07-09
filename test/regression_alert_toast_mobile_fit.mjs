// Regression — alert popup toast must fit within a phone-sized viewport.
//
// Bug: fireAlert() creates a toast with inline style
// `position:fixed;top:60px;right:320px;...;max-width:320px`. On a 360px-wide
// viewport, right:320px leaves only ~40px of shrink-to-fit width, so the
// toast renders as a tall skinny strip instead of a usable near-full-width
// banner.
//   Run:  node test/regression_alert_toast_mobile_fit.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/?embed=1&sym=BTC-USD&tf=1d';
const VIEWPORT = { width: 360, height: 780 };

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize(VIEWPORT);
const errs = [];
p.on('pageerror', e => errs.push(e.message));

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(4000);

const bodyChildCountBefore = await p.evaluate(() => document.body.children.length);

await p.evaluate(() => {
  fireAlert(
    { id: 't1', source: 'price', op: 'gt', target: 'value', value: 1,
      message: 'BTC-USD Price Crossing 63159.62',
      notify: { popup: true, sound: false, browser: false },
      sound: { kind: 'sound', id: 'beep' } },
    63161.78, 63159.62
  );
});
await p.waitForTimeout(200);

const toastRect = await p.evaluate(() => {
  const els = Array.from(document.body.children).filter(
    el => el.style && el.style.position === 'fixed' && el.style.backgroundColor === 'rgb(247, 82, 95)'
  );
  const el = els[els.length - 1];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
});

const bodyChildCountAfter = await p.evaluate(() => document.body.children.length);

console.log('viewport:', JSON.stringify(VIEWPORT));
console.log('body children before/after:', bodyChildCountBefore, bodyChildCountAfter);
console.log('toast rect:', JSON.stringify(toastRect));

const found = !!toastRect;
const widthOk = found && toastRect.width >= 300;
const leftOk = found && toastRect.left >= 0;
const rightOk = found && toastRect.right <= VIEWPORT.width;
const notSkinnyStrip = found && toastRect.width > toastRect.height;
const noErrs = errs.length === 0;

console.log(JSON.stringify({
  found, widthOk, leftOk, rightOk, notSkinnyStrip, noErrs, errs
}, null, 2));

console.log(`found toast:        ${found ? 'PASS' : 'FAIL'}`);
console.log(`width >= 300:       ${widthOk ? 'PASS' : 'FAIL'} (actual: ${found ? toastRect.width.toFixed(1) : 'n/a'})`);
console.log(`left >= 0:          ${leftOk ? 'PASS' : 'FAIL'} (actual: ${found ? toastRect.left.toFixed(1) : 'n/a'})`);
console.log(`right <= 360:       ${rightOk ? 'PASS' : 'FAIL'} (actual: ${found ? toastRect.right.toFixed(1) : 'n/a'})`);
console.log(`width > height:     ${notSkinnyStrip ? 'PASS' : 'FAIL'} (actual: ${found ? `${toastRect.width.toFixed(1)} vs ${toastRect.height.toFixed(1)}` : 'n/a'})`);
console.log(`no pageerror:       ${noErrs ? 'PASS' : 'FAIL'}`);

await b.close();

const ok = found && widthOk && leftOk && rightOk && noErrs;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
