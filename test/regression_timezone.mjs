// Feature test — timezone selector (TradingView parity + bug fix).
//
// Bug: the tz selector sits at the bottom edge of the screen (#bottomRight), and its
// dropdown opened DOWNWARD (top:100%) → rendered offscreen, so clicking an option was
// unreachable. Fix: menu opens upward/right-aligned; full TV zone list; picking a zone
// relabels every pane's time axis and persists by index.
//   Run:  node test/regression_timezone.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — full TV zone list rendered (many entries, (UTC±N) labels present).
const list = await p.evaluate(() => {
  const opts = [...document.querySelectorAll('#tzMenu .tf-opt')].map(o => o.textContent);
  return { count: opts.length, hasNY: opts.includes('(UTC-4) New York'),
    hasTokyo: opts.includes('(UTC+9) Tokyo'), hasKolkata: opts.includes('(UTC+5:30) Kolkata'),
    hasLocal: opts.includes('Local') };
});
const t1 = list.count >= 60 && list.hasNY && list.hasTokyo && list.hasKolkata && list.hasLocal;

// t2 — menu opens UPWARD and stays within the viewport (the actual reported bug).
await p.evaluate(() => document.getElementById('tzSelBtn').click());
await p.waitForTimeout(200);
const geo = await p.evaluate(() => {
  const sel = document.getElementById('tzSel');
  const btn = document.getElementById('tzSelBtn').getBoundingClientRect();
  const menu = document.getElementById('tzMenu').getBoundingClientRect();  // now parented to <body>
  return { open: sel.classList.contains('open'), btnTop: btn.top, onBody: document.getElementById('tzMenu').parentElement === document.body,
    menuTop: menu.top, menuBottom: menu.bottom, vh: window.innerHeight };
});
// menu must sit ABOVE the button and be fully on-screen (top>=0)
const t2 = geo.open && geo.menuBottom <= geo.btnTop + 2 && geo.menuTop >= 0;

// t2b — options that overlap the chart must be the topmost element at their own center
// (not swallowed by the #draw canvas overlay). This is the actual "can't click the ones
// touching the chart" bug: the menu opens up INTO the chart, and the drawing canvas
// (z-index:100) covered the upper options. elementFromPoint must return the option.
const hit = await p.evaluate(() => {
  const opts = [...document.querySelectorAll('#tzMenu .tf-opt')];
  // pick an option near the TOP of the menu (guaranteed to overlap the chart area)
  const top = opts.find(o => o.textContent.includes('Honolulu')) || opts[3];
  const r = top.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const overChart = r.top < document.getElementById('chart').getBoundingClientRect().bottom;
  return { label: top.textContent, overChart, topmostIsOpt: !!el && (el === top || top.contains(el)),
    topmostId: el ? (el.id || el.className) : null };
});
const t2b = hit.overChart && hit.topmostIsOpt;

// t3 — a REAL (hit-tested) click on an option that overlaps the chart applies it.
await p.locator('#tzMenu .tf-opt', { hasText: '(UTC-8) Los Angeles' }).click();
await p.waitForTimeout(200);
const applied = await p.evaluate(() => ({
  off: tzOffsetMin, label: document.getElementById('tzSelLabel').textContent,
  open: document.getElementById('tzSel').classList.contains('open'),
}));
const t3 = applied.off === -480 && /UTC-8/.test(applied.label) && !applied.open;

// t4 — the chart's time-axis labels actually shift with the zone (compare a tick label
// under UTC vs under a far-east zone).
const shift = await p.evaluate(() => {
  // sample the tickLabel for a known intraday time under two zones
  const t = lastData[lastData.length - 1].time;
  const setZone = idx => { applyTz(idx); return tickLabel(t, 3); };  // type 3 = HH:MM
  const utc = setZone(0);          // UTC
  const tokyo = setZone(TIMEZONES.findIndex(z => z.label === '(UTC+9) Tokyo'));
  applyTz(0);
  return { utc, tokyo };
});
const t4 = shift.utc !== shift.tokyo;

// t5 — selection persists by index across reload.
await p.evaluate(() => { const j = TIMEZONES.findIndex(z => z.label === '(UTC+9) Tokyo'); applyTz(j); });
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
const persisted = await p.evaluate(() => ({
  label: document.getElementById('tzSelLabel').textContent, off: tzOffsetMin,
}));
const t5 = /UTC\+9/.test(persisted.label) && persisted.off === 540;

const t6 = errs.length === 0;
const all = [t1, t2, t2b, t3, t4, t5, t6];
console.log(`t1 full TV zone list       : ${t1}  (${JSON.stringify(list)})`);
console.log(`t2 menu opens upward on-screen: ${t2}  (${JSON.stringify(geo)})`);
console.log(`t2b overlapping opt is clickable (not under #draw): ${t2b}  (${JSON.stringify(hit)})`);
console.log(`t3 real click on chart-overlapping opt applies: ${t3}  (${JSON.stringify(applied)})`);
console.log(`t4 axis labels shift w/ zone: ${t4}  (${JSON.stringify(shift)})`);
console.log(`t5 persists by index reload: ${t5}  (${JSON.stringify(persisted)})`);
console.log(`t6 no page errors          : ${t6}  ${errs.join(' | ')}`);
console.log(all.every(Boolean) ? `PASS ${all.length}/${all.length}` : 'FAIL');
await b.close();
process.exit(all.every(Boolean) ? 0 : 1);
