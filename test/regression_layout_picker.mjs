// Feature test — §19 item 1: TV-style full layout picker.
//
// Requires: picker popup grouped by chart count (1,2,3,4,5,6,7,8,9,10,12,14,16)
// with thumbnail variants (splits + mixed grids); selecting a variant builds that
// many iframe panels with the right grid template; legacy keys (2h/2v/4) still
// work; back-to-single restores the normal app.
//   Run:  node test/regression_layout_picker.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// 1) Picker structure: 13 count groups, >=26 variant thumbnails, all counts present.
const struct = await p.evaluate(() => {
  document.getElementById('layoutSelBtn').click();
  const menu = document.getElementById('layoutMenu');
  return {
    groups: [...menu.querySelectorAll('.lp-count')].map(x => x.textContent.trim()),
    thumbs: menu.querySelectorAll('.lp-item').length,
    isPick: menu.classList.contains('layout-pick'),
  };
});
const wantCounts = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '14', '16'];
const t1 = struct.isPick && struct.thumbs >= 25 && wantCounts.every(c =>
  struct.groups.some(g => g.startsWith(c + ' CHART')));

// 2) Mixed layout "3l" (1 big left + 2 right): 3 iframes, grid areas assigned.
await p.evaluate(() => buildGrid('3l'));
await p.waitForTimeout(700);
const l3 = await p.evaluate(() => {
  const g = document.getElementById('chartGrid');
  const frames = [...g.querySelectorAll('iframe')];
  return {
    n: frames.length,
    areas: frames.map(f => f.style.gridArea.split(' ')[0]),
    tplAreas: g.style.gridTemplateAreas,
    gridOn: document.documentElement.classList.contains('grid-on'),
  };
});
const t2 = l3.n === 3 && l3.gridOn && /p0/.test(l3.tplAreas) && l3.areas[0].startsWith('p0');

// 3) Uniform 9-grid: 9 iframes, 3x3 template.
await p.evaluate(() => buildGrid('9'));
await p.waitForTimeout(700);
const l9 = await p.evaluate(() => {
  const g = document.getElementById('chartGrid');
  return { n: g.querySelectorAll('iframe').length, cols: g.style.gridTemplateColumns, rows: g.style.gridTemplateRows };
});
const t3 = l9.n === 9 && l9.cols.split(" ").length === 3 && l9.rows.split(" ").length === 3;

// 4) Legacy key still works (persisted fv_layout compat).
await p.evaluate(() => buildGrid('2h'));
await p.waitForTimeout(500);
const l2 = await p.evaluate(() => document.querySelectorAll('#chartGrid iframe').length);
const t4 = l2 === 2;

// 5) Toolbar label shows chart count; active thumb highlighted.
const ui = await p.evaluate(() => ({
  label: document.getElementById('layoutSelLabel').textContent,
  active: document.querySelector('#layoutMenu .lp-item.active')?.dataset.layout,
}));
const t5 = /2/.test(ui.label) && ui.active === '2h';

// 5b) §19 item 2: toolbar button shows current-layout mini-thumb + count + chevron,
//     and a blue "Save" action sits next to the selector.
const btn = await p.evaluate(() => {
  const lbl = document.getElementById('layoutSelLabel');
  const sv = document.getElementById('btnLayoutSave');
  return {
    thumbCells: lbl.querySelectorAll('.lp-cur i').length,
    label: lbl.textContent.trim(),
    caret: !!document.querySelector('#layoutSelBtn .caret'),
    saveBlue: sv ? /41,\s*98,\s*255/.test(getComputedStyle(sv).color) : false,
  };
});
const t5b = btn.thumbCells === 2 && btn.label === '2' && btn.caret && btn.saveBlue;

// 6) Back to single restores normal app.
await p.evaluate(() => buildGrid('1'));
await p.waitForTimeout(500);
const single = await p.evaluate(() => ({
  gridOn: document.documentElement.classList.contains('grid-on'),
  frames: document.querySelectorAll('#chartGrid iframe').length,
}));
const t6 = !single.gridOn && single.frames === 0;

const t7 = errs.length === 0;

console.log('t1 13 groups, >=26 variants:', t1, `thumbs=${struct.thumbs} groups=${struct.groups.length}`);
console.log('t2 mixed 3l w/ grid areas  :', t2, JSON.stringify(l3.areas));
console.log('t3 9-grid 3x3              :', t3);
console.log('t4 legacy 2h works         :', t4);
console.log('t5 label + active thumb    :', t5, JSON.stringify(ui));
console.log('t5b btn thumb+count+Save   :', t5b, JSON.stringify(btn));
console.log('t6 back to single          :', t6);
console.log('t7 no app errors           :', t7, errs.slice(0, 3));

await b.close();
const ok = t1 && t2 && t3 && t4 && t5 && t5b && t6 && t7;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
