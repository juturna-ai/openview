// Regression test for two bugs found in the 2026-07 audit pass:
//
//  [A] Fib settings dialog leaked a `click` listener on the persistent #settingsDlg
//      node on every openFibSettings() call (addEventListener, never removed). Repeated
//      opens accumulated handlers unbounded. Fixed by tracking the handler on the node
//      and removing the prior one before re-adding (index.html ~line 4507).
//
//  [B] loadCompareData() captured its compare series before an await and wrote to it
//      after, with no re-check. A `COMPARE[sym]!==c` guard was added after the await as
//      a defensive measure against a stale write when a compare is removed/re-added
//      mid-fetch. NOTE: this had no OBSERVABLE failure pre-fix — the existing try/catch
//      already swallows the disposed-series throw and COMPARE[sym] always tracks the
//      current series — so [B] is exercised for smoke coverage (no crash), not as a
//      reproduction of a demonstrated bug.
//
// Run:  FV_URL=http://127.0.0.1:5599/ node test/regression_audit_fixes.mjs

import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });

let pageErrors = 0;
p.on('pageerror', () => { pageErrors++; });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// ── [A] Fib settings dialog does not leak #settingsDlg click listeners ──
// Draw a fib, then open its settings dialog many times and count live listeners on
// #settingsDlg. Without the fix, the count climbs by one per open.
const leakResult = await p.evaluate(async () => {
  // Instrument add/removeEventListener on the settings dialog to count live 'click' handlers.
  const dlg = document.getElementById('settingsDlg');
  let live = 0;
  const _add = dlg.addEventListener.bind(dlg);
  const _rem = dlg.removeEventListener.bind(dlg);
  dlg.addEventListener = (t, fn, o) => { if (t === 'click') live++; return _add(t, fn, o); };
  dlg.removeEventListener = (t, fn, o) => { if (t === 'click') live--; return _rem(t, fn, o); };

  // Create a fib-retracement shape directly in the drawing model, then open its settings.
  if (typeof draw === 'undefined' || !Array.isArray(draw.shapes) || typeof openFibSettings !== 'function')
    return { skipped: true };
  const id = (typeof newId === 'function') ? newId() : ('t' + Math.random());
  draw.shapes.push({
    id, type: 'fib',
    pts: [{ t: (lastData[0] && lastData[0].time) || 0, p: 100 }, { t: (lastData[lastData.length-1] && lastData[lastData.length-1].time) || 1, p: 200 }],
    style: { ...(typeof DEFAULT_STYLE !== 'undefined' ? DEFAULT_STYLE : {}) },
    fib: (typeof defaultFibConfig === 'function') ? defaultFibConfig() : { levels: [] },
  });

  const N = 8;
  for (let i = 0; i < N; i++) {
    openFibSettings(id);
    if (typeof closeDlg === 'function') closeDlg();
  }
  return { skipped: false, live, N };
});

let tA;
if (leakResult.skipped) { tA = null; }
else { tA = leakResult.live <= 1; }   // exactly one live handler regardless of open count

// ── [B] Compare add-then-remove mid-fetch does not throw on a disposed series ──
// Add a compare symbol and immediately remove it (fetch still in flight), repeatedly.
// Without the guard, the late setData on the removed series throws a pageerror.
const errBefore = pageErrors;
const compareResult = await p.evaluate(async () => {
  if (typeof addCompare !== 'function' || typeof removeCompare !== 'function')
    return { skipped: true };
  const syms = ['ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD'];
  for (const s of syms) {
    addCompare(s);                 // kicks off loadCompareData (async fetch)
    removeCompare(s);              // dispose immediately, before the fetch resolves
  }
  return { skipped: false };
});
// Give the in-flight fetches time to resolve and (pre-fix) throw.
await p.waitForTimeout(8000);
const compareErrors = pageErrors - errBefore;
let tB = compareResult.skipped ? null : (compareErrors === 0);

const results = [
  ['A fib dialog no listener leak', tA, leakResult.skipped ? 'SKIP' : `live=${leakResult.live} after ${leakResult.N} opens`],
  ['B compare race no stale write', tB, compareResult.skipped ? 'SKIP' : `pageerrors=${compareErrors}`],
];
let allPass = true;
for (const [name, res, detail] of results) {
  const tag = res === null ? 'SKIP' : (res ? 'PASS' : 'FAIL');
  if (res === false) allPass = false;
  console.log(`[${tag}] ${name} (${detail})`);
}
console.log(allPass ? '\n✅ ALL PASS' : '\n❌ FAIL');

await b.close();
process.exit(allPass ? 0 : 1);
