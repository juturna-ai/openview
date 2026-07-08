// Feature test — §18: docked right-rail panels + Object tree TV parity.
//
// Requires: rail icons open panels DOCKED in the right sidebar (#rightPanel replaces
// the watchlist — never floating), Object tree has "Object tree | Data window" tabs,
// toolbar (group/clone/z-order/clean-all), drawing rows with hover lock/eye/delete
// (hidden = greyed + slashed eye), click-select, double-click rename, and the Data
// window tab shows OHLC + indicator values.
//   Run:  node test/regression_objtree_dock.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

const railClick = title => p.evaluate(t =>
  [...document.querySelectorAll('#rightRail .rr-btn')].find(b => b.title === t).click(), title);

// t1 — Object tree opens DOCKED: #rightPanel visible in the sidebar flow, watchlist
// hidden, no floating #objTree/#stubPanel, tabs present.
await railClick('Object tree');
await p.waitForTimeout(300);
const dock = await p.evaluate(() => {
  const rp = document.getElementById('rightPanel');
  const cs = getComputedStyle(rp);
  return {
    open: rp.classList.contains('open') && cs.display !== 'none',
    docked: cs.position === 'relative' && rp.parentElement.id === 'app',
    wlHidden: getComputedStyle(document.getElementById('watchlist')).display === 'none',
    noFloat: !document.getElementById('objTree') && !document.getElementById('stubPanel'),
    tabs: [...document.querySelectorAll('#rightPanel .rp-tab')].map(t => t.textContent),
    active: [...document.querySelectorAll('#rightRail .rr-btn')].find(b => b.title === 'Object tree').classList.contains('rr-active'),
  };
});
const t1 = dock.open && dock.docked && dock.wlHidden && dock.noFloat && dock.active
  && dock.tabs.join('|') === 'Object tree|Data window';

// Seed two drawings + toolbar row exists.
await p.evaluate(() => {
  const t0 = lastData[Math.max(0, lastData.length - 60)].time, t1 = lastData[lastData.length - 10].time;
  const pr = lastData[lastData.length - 1].close;
  draw.shapes.push({ id: newId(), type: 'trend', pts: [{ time: t0, price: pr * 0.95 }, { time: t1, price: pr * 1.02 }], style: { ...DEFAULT_STYLE } });
  draw.shapes.push({ id: newId(), type: 'ellipse', pts: [{ time: t0, price: pr * 0.9 }, { time: t1, price: pr * 0.97 }], style: { ...DEFAULT_STYLE } });
  persist(); redraw();
});
await p.waitForTimeout(300);
const tree = await p.evaluate(() => ({
  rows: [...document.querySelectorAll('#otContent .ot-row[data-shape]')].map(r => r.querySelector('.ot-nm').textContent),
  toolbar: [...document.querySelectorAll('#otContent .ot-toolbar .ot-tb')].map(x => x.dataset.tb),
  symRow: document.querySelector('#otContent .ot-sym .ot-nm').textContent,
  icons: document.querySelectorAll('#otContent .ot-row[data-shape] .ot-ic svg').length,
}));
const t2 = tree.rows.includes('Trend Line') && tree.rows.includes('Ellipse')
  && tree.toolbar.join(',') === 'group,clone,zorder,clean'
  && /·/.test(tree.symRow) && tree.icons === 2;

// t3 — hide from tree: eye toggles s.hidden, row greys (ot-hidden), redraw skips it.
const hid = await p.evaluate(() => {
  const row = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.querySelector('.ot-nm').textContent === 'Trend Line');
  row.querySelector('[data-act="hide"]').click();
  const s = draw.shapes.find(x => x.type === 'trend');
  const row2 = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.querySelector('.ot-nm').textContent === 'Trend Line');
  return { hidden: !!s.hidden, greyed: row2.classList.contains('ot-hidden') };
});
const t3 = hid.hidden && hid.greyed;

// t4 — lock from tree: lock toggles s.locked and pins the icon (.on).
const lock = await p.evaluate(() => {
  const row = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.querySelector('.ot-nm').textContent === 'Ellipse');
  row.querySelector('[data-act="lock"]').click();
  const s = draw.shapes.find(x => x.type === 'ellipse');
  const row2 = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.querySelector('.ot-nm').textContent === 'Ellipse');
  return { locked: !!s.locked, pinned: !!row2.querySelector('[data-act="lock"].on') };
});
const t4 = lock.locked && lock.pinned;

// t5 — click selects on chart; double-click renames.
const selRen = await p.evaluate(async () => {
  const row = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.querySelector('.ot-nm').textContent === 'Ellipse');
  row.click();
  const selected = draw.sel === row.dataset.shape;
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const inp = row.querySelector('.ot-nm input');
  if (!inp) return { selected, renamed: false };
  inp.value = 'My circle';
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const s = draw.shapes.find(x => x.type === 'ellipse');
  const row2 = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.dataset.shape === s.id);
  return { selected, renamed: s.name === 'My circle' && row2.querySelector('.ot-nm').textContent === 'My circle' };
});
const t5 = selRen.selected && selRen.renamed;

// t6 — delete from tree removes the shape + row.
const del = await p.evaluate(() => {
  const n0 = draw.shapes.length;
  const row = [...document.querySelectorAll('#otContent .ot-row[data-shape]')]
    .find(r => r.querySelector('.ot-nm').textContent === 'Trend Line');
  row.querySelector('[data-act="del"]').click();
  return { gone: draw.shapes.length === n0 - 1 && !draw.shapes.find(s => s.type === 'trend'),
           rows: document.querySelectorAll('#otContent .ot-row[data-shape]').length };
});
const t6 = del.gone && del.rows === 1;

// t7 — Data window tab: OHLC rows populated at latest bar.
await p.evaluate(() => [...document.querySelectorAll('#rightPanel .rp-tab')].find(t => t.dataset.t === 'data').click());
await p.waitForTimeout(200);
const dw = await p.evaluate(() => ({
  o: document.getElementById('dwO')?.textContent, c: document.getElementById('dwC')?.textContent,
  date: document.getElementById('dwDate')?.textContent, rsi: document.getElementById('dwRsi')?.textContent,
}));
const t7 = dw.o && dw.o !== '—' && dw.c !== '—' && /^\d{4}-\d{2}-\d{2}$/.test(dw.date || '') && dw.rsi && dw.rsi !== '—';

// t8 — switching rail icons swaps the docked panel; clicking active icon closes it
// (watchlist returns); topbar 🗂 re-opens docked.
await railClick('News');
await p.waitForTimeout(200);
const news = await p.evaluate(() => ({
  title: document.getElementById('rpTitle').textContent,
  open: document.getElementById('rightPanel').classList.contains('open'),
}));
await railClick('News');   // toggle same icon → close
await p.waitForTimeout(200);
const closed = await p.evaluate(() => ({
  open: document.getElementById('rightPanel').classList.contains('open'),
  wlBack: getComputedStyle(document.getElementById('watchlist')).display !== 'none',
}));
await p.evaluate(() => document.getElementById('btnObjTree').click());
await p.waitForTimeout(200);
const reopen = await p.evaluate(() =>
  document.getElementById('rightPanel').classList.contains('open') && !!document.querySelector('#rightPanel .rp-tabs'));
const t8 = news.title === 'News' && news.open && !closed.open && closed.wlBack && reopen;

const t9 = errs.length === 0;
const all = [t1, t2, t3, t4, t5, t6, t7, t8, t9];
console.log(`t1 docked-not-floating: ${t1}  (${JSON.stringify(dock)})`);
console.log(`t2 tree rows/toolbar/symbol: ${t2}  (${JSON.stringify(tree)})`);
console.log(`t3 hide from tree: ${t3}`);
console.log(`t4 lock from tree: ${t4}`);
console.log(`t5 select + rename: ${t5}  (${JSON.stringify(selRen)})`);
console.log(`t6 delete from tree: ${t6}`);
console.log(`t7 data window values: ${t7}  (${JSON.stringify(dw)})`);
console.log(`t8 switch/toggle/topbar: ${t8}`);
console.log(`t9 no page errors: ${t9}  ${errs.join(' | ')}`);
console.log(all.every(Boolean) ? `PASS ${all.length}/${all.length}` : 'FAIL');
await b.close();
process.exit(all.every(Boolean) ? 0 : 1);
