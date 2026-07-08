// Regression — Chart settings "Done" must fully close (no stuck dim backdrop).
//
// Bug: openChartSettings() showed the backdrop via inline style.display="block", but
// closeDlg() only removes the .open CLASS — so the inline display:block survived and the
// screen stayed dimmed after clicking Done, requiring a refresh. Fix: open via the .open
// class like every other dialog. This test opens settings, clicks Done, and asserts the
// backdrop is actually hidden (computed display:none) and the chart is interactive again.
//   Run:  node test/regression_chartsettings_close.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// open Chart settings from the ⚙ button
await p.evaluate(() => document.getElementById('btnSettings').click());
await p.waitForTimeout(300);
const opened = await p.evaluate(() => ({
  dlgOpen: document.getElementById('settingsDlg').classList.contains('open'),
  backdropVisible: getComputedStyle(document.getElementById('dlgBackdrop')).display !== 'none',
  hasDone: !!document.getElementById('cs_ok'),
}));
const t1 = opened.dlgOpen && opened.backdropVisible && opened.hasDone;

// click Done
await p.locator('#cs_ok').click();
await p.waitForTimeout(300);
const closed = await p.evaluate(() => {
  const bd = document.getElementById('dlgBackdrop');
  return {
    dlgOpen: document.getElementById('settingsDlg').classList.contains('open'),
    backdropDisplay: getComputedStyle(bd).display,
    backdropInline: bd.style.display,   // must NOT be a stuck "block"
  };
});
// backdrop fully gone: computed display:none AND no leftover inline block
const t2 = !closed.dlgOpen && closed.backdropDisplay === 'none' && closed.backdropInline !== 'block';

// chart is interactive again — the topmost element over the chart center is NOT the backdrop
const t3 = await p.evaluate(() => {
  const c = document.getElementById('chart').getBoundingClientRect();
  const el = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
  return el && el.id !== 'dlgBackdrop' && !el.closest('#dlgBackdrop');
});

// close via the × should also clear it (re-open then ×)
await p.evaluate(() => document.getElementById('btnSettings').click());
await p.waitForTimeout(200);
await p.locator('#settingsDlg .cl').click();
await p.waitForTimeout(200);
const t4 = await p.evaluate(() => getComputedStyle(document.getElementById('dlgBackdrop')).display === 'none');

const t5 = errs.length === 0;
const all = [t1, t2, t3, t4, t5];
console.log(`t1 settings opens w/ backdrop : ${t1}  (${JSON.stringify(opened)})`);
console.log(`t2 Done clears backdrop       : ${t2}  (${JSON.stringify(closed)})`);
console.log(`t3 chart interactive after    : ${t3}`);
console.log(`t4 × also clears backdrop     : ${t4}`);
console.log(`t5 no page errors             : ${t5}  ${errs.join(' | ')}`);
console.log(all.every(Boolean) ? `PASS ${all.length}/${all.length}` : 'FAIL');
await b.close();
process.exit(all.every(Boolean) ? 0 : 1);
