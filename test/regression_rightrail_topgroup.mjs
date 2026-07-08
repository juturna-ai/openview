// Feature test — §18 item 1: Right rail top-group icons.
//
// Requires: Watchlist, Alerts, Object tree, Ideas/Chat (stub) icons, each opening
// its panel, active icon highlighted (blue), thin-line SVG (not emoji) for the top
// group, tooltips (title attr), and last-opened remembered across reload.
//   Run:  node test/regression_rightrail_topgroup.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// Rail structure: 4 SVG top icons + a spacer + 3 bottom (emoji) icons; titles present.
const struct = await p.evaluate(() => {
  const rail = document.getElementById('rightRail');
  const btns = [...rail.querySelectorAll('.rr-btn')];
  return {
    total: btns.length,
    hasSpacer: !!rail.querySelector('.rr-spacer'),
    titles: btns.map(b => b.title),
    svgCount: btns.filter(b => b.querySelector('svg')).length,
  };
});
const wantTitles = ['Watchlist', 'Alerts', 'Object tree', 'Ideas & Chat', 'News', 'Screener', 'Paper trading'];
const t1 = wantTitles.every(t => struct.titles.includes(t));
const t2 = struct.hasSpacer;
const t3 = struct.svgCount >= 4;   // top group are thin-line SVGs

// Ideas & Chat opens its stub panel (docked in the right sidebar).
await p.evaluate(() => [...document.querySelectorAll('#rightRail .rr-btn')].find(b => b.title === 'Ideas & Chat').click());
await p.waitForTimeout(300);
const ideas = await p.evaluate(() => {
  const box = document.getElementById('rightPanel');           // panels dock here now
  const open = box && box.classList.contains('open');
  const txt = box ? box.textContent : '';
  const active = [...document.querySelectorAll('#rightRail .rr-btn')].find(b => b.title === 'Ideas & Chat').classList.contains('rr-active');
  return { open, hasTitle: /Ideas & Chat/.test(txt), active };
});
const t4 = ideas.open && ideas.hasTitle;

// Active icon highlighted blue.
const activeColor = await p.evaluate(() => {
  const b = [...document.querySelectorAll('#rightRail .rr-btn')].find(x => x.classList.contains('rr-active'));
  return b ? getComputedStyle(b).color : null;
});
const t5 = ideas.active && /41,\s*98,\s*255/.test(activeColor || '');   // #2962ff

// Last-opened persisted + restored on reload.
const persisted = await p.evaluate(() => localStorage.getItem('fv_rail_active'));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
const afterReload = await p.evaluate(() => ({
  stored: localStorage.getItem('fv_rail_active'),
  panelOpen: (() => { const box = document.getElementById('rightPanel'); return box && box.classList.contains('open') && /Ideas & Chat/.test(box.textContent); })(),
  active: (() => { const b = [...document.querySelectorAll('#rightRail .rr-btn')].find(x => x.title === 'Ideas & Chat'); return b && b.classList.contains('rr-active'); })(),
}));
const t6 = persisted === 'ideas' && afterReload.stored === 'ideas' && afterReload.panelOpen && afterReload.active;

const t7 = errs.length === 0;

console.log('t1 all 7 titles present    :', t1, struct.titles.join(','));
console.log('t2 spacer between groups   :', t2);
console.log('t3 >=4 SVG top icons       :', t3, `svg=${struct.svgCount}`);
console.log('t4 Ideas stub opens        :', t4);
console.log('t5 active icon blue         :', t5, activeColor);
console.log('t6 last-opened restored    :', t6, JSON.stringify(afterReload));
console.log('t7 no app errors           :', t7, errs.slice(0, 3));

await b.close();
const ok = t1 && t2 && t3 && t4 && t5 && t6 && t7;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
