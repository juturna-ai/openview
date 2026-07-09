// Regression — create-alert dialog must fit within a phone-sized viewport.
//
// Bug: #alertDlg (.dialog.alertdlg) has a fixed width:440px, centered via
// translate(-50%,-50%). On a 360px-wide viewport this overflows left/right
// and clips the .alabel column.
//   Run:  node test/regression_alert_dialog_mobile_fit.mjs
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

await p.evaluate(() => openAlertDialog({}));
await p.waitForTimeout(200);

const dlgRect = await p.evaluate(() => {
  const el = document.getElementById('alertDlg');
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
});

const labelRect = await p.evaluate(() => {
  const el = document.querySelector('#alertDlg .alabel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});

const fitsHorizontally = dlgRect.left >= 0 && dlgRect.right <= VIEWPORT.width;
const fitsVertically = dlgRect.top >= 0 && dlgRect.bottom <= VIEWPORT.height;
const labelNotClipped = !!labelRect && labelRect.left >= 0;

console.log('viewport:', JSON.stringify(VIEWPORT));
console.log('alertDlg rect:', JSON.stringify(dlgRect));
console.log('.alabel rect:', JSON.stringify(labelRect));
console.log(JSON.stringify({
  fitsHorizontally, fitsVertically, labelNotClipped, errs
}, null, 2));

await b.close();

const ok = fitsHorizontally && fitsVertically && labelNotClipped && errs.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
