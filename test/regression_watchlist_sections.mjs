// Regression — watchlist section UX:
//  1. Default "comeback" list loads with exactly the 5 screenshot sections
//     (PRIVACY, OMEGA, ALPHA, SECTION 2, BTC PAIRS) — no SPREADS/MEME/SECTION 3.
//  2. moveGroup() reorders whole sections (drag a header up/down).
//  3. Section header caret shows − when expanded, + when collapsed.
//
//   Run:  node test/regression_watchlist_sections.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
// Fresh browser context (no prior localStorage) so the default seed is what loads.
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForFunction(() => typeof GROUPS !== 'undefined' && GROUPS.length > 0, { timeout: 20000 }).catch(()=>{});
await p.waitForTimeout(1500);

// t1 — default sections are exactly the two, in order, with the right symbols.
const t1 = await p.evaluate(() => {
  const want = ['ALPHA','SECTION 2'];
  const got = GROUPS.map(g => g.name);
  const alphaOk = JSON.stringify((GROUPS.find(g=>g.name==='ALPHA')||{}).symbols)
    === JSON.stringify(['ASTER-USD','TAO-USD','INJ-USD','NEAR-USD']);
  return JSON.stringify(got) === JSON.stringify(want) && alphaOk;
});

// t1b — no unwanted sections present.
const t1b = await p.evaluate(() =>
  !GROUPS.some(g => ['SPREADS','MEME','SECTION 3','PRIVACY','OMEGA','BTC PAIRS'].includes(g.name)));

// t2 — moveGroup moves a section. Move SECTION 2 to the top (before ALPHA).
const t2 = await p.evaluate(() => {
  moveGroup('SECTION 2', 'ALPHA', /*before=*/true);
  return GROUPS[0].name === 'SECTION 2';
});

// t2b — reorder persisted to localStorage.
const t2b = await p.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('fv_watchlist'));
  return saved[0].name === 'SECTION 2';
});

// t3 — caret glyph reflects collapse state: − expanded, + collapsed.
const t3 = await p.evaluate(() => {
  const g = GROUPS[0];
  if (g.collapsed) toggleGroupCollapse(g.name);      // ensure expanded
  const expandedCaret = document.querySelector(`.section[data-group="${CSS.escape(g.name)}"] .caret`).textContent;
  toggleGroupCollapse(g.name);                        // collapse
  const collapsedCaret = document.querySelector(`.section[data-group="${CSS.escape(g.name)}"] .caret`).textContent;
  toggleGroupCollapse(g.name);                        // restore
  return expandedCaret === '−' && collapsedCaret === '+';
});

console.log(JSON.stringify({ t1_fiveSections:t1, t1b_noExtras:t1b, t2_moveGroup:t2, t2b_persist:t2b, t3_caret:t3, errs }, null, 2));
await b.close();
const ok = t1 && t1b && t2 && t2b && t3 && errs.length === 0;
process.exit(ok ? 0 : 1);
