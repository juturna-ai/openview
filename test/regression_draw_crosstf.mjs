// Feature test — drawings persist across timeframes (per symbol, not per symbol+tf).
//
// Bug: a tool drawn on 1H vanished when switching to 2H because drawings were keyed
// per symbol+timeframe (fv_draw_<sym>_<tf>). Shape points store absolute time+price
// (timeframe-independent), so a drawing must appear on ALL timeframes of a symbol.
// Fix: key drawings per symbol only (fv_draw_<sym>) + one-time migration that merges
// any legacy per-tf entries into the symbol key (deduped by shape id).
//   Run:  node test/regression_draw_crosstf.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — persistKey is symbol-only (no timeframe suffix). selectTF() switches the
// real activeTF; the key must be identical before and after and carry no _<tf>.
const t1 = await p.evaluate(() => {
  selectTF('1h'); const k1 = persistKey();
  selectTF('2h'); const k2 = persistKey();
  return k1 === k2 && k1.indexOf('fv_draw_') === 0 && !/_1h$|_2h$/.test(k1);
});

// t2 — legacy per-tf entries are merged (deduped by id) into the symbol key and removed.
const t2 = await p.evaluate(() => {
  const base = persistKey();
  // seed two legacy keys: shape A on 1h, shapes A+B on 2h (A is a duplicate id).
  localStorage.removeItem(base);
  localStorage.setItem(base + '_1h', JSON.stringify([{ id: 'A', type: 'trend', pts: [] }]));
  localStorage.setItem(base + '_2h', JSON.stringify([
    { id: 'A', type: 'trend', pts: [] }, { id: 'B', type: 'hline', pts: [] }]));
  loadPersisted();  // triggers migrateLegacyDraw()
  const ids = draw.shapes.map(s => s.id).sort().join(',');
  const legacyGone = !localStorage.getItem(base + '_1h') && !localStorage.getItem(base + '_2h');
  const merged = localStorage.getItem(base);
  return ids === 'A,B' && legacyGone && !!merged;
});

// t3 — a drawing saved while on 1h is present after switching to 2h through the
// real selectTF() code path (which reloads persisted drawings for the new TF).
const t3 = await p.evaluate(() => {
  selectTF('1h');
  localStorage.removeItem(persistKey());
  draw.shapes = [{ id: 'Z', type: 'trend', pts: [{ time: 1, price: 1 }, { time: 2, price: 2 }] }];
  draw.sel = null; persist();
  selectTF('2h');   // internally calls loadPersisted() for the (unchanged) symbol key
  return draw.shapes.length === 1 && draw.shapes[0].id === 'Z';
});

console.log('t1 symbol-only key:', t1 ? 'PASS' : 'FAIL');
console.log('t2 legacy migration:', t2 ? 'PASS' : 'FAIL');
console.log('t3 cross-tf persistence:', t3 ? 'PASS' : 'FAIL');
if (errs.length) console.log('pageerrors:', errs);
await b.close();
process.exit(t1 && t2 && t3 && !errs.length ? 0 : 1);
