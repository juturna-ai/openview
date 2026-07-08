// Audit — Spread builder tab in the Add-symbol dialog.
//  1. Opening the dialog shows a "Spread" tab.
//  2. Switching to it renders the two-slot (A / B) builder, no flat list.
//  3. Filling slot A then slot B (via chooseSpreadLeg) and clicking "Add spread"
//     pushes "<legA>/<legB>" into the section and closes the dialog.
//
//   Run:  node test/audit_spread_builder.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5599/index.html';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForFunction(() => typeof GROUPS !== 'undefined' && GROUPS.length > 0, { timeout: 20000 }).catch(()=>{});
await p.waitForTimeout(800);

// Seed a known section + fake product pool so the test is network-independent.
await p.evaluate(() => {
  GROUPS.length = 0;
  GROUPS.push({ name: 'SPREAD TEST', symbols: [] });
  saveGroups();
  // Assign the real module binding (not window.*) so symMatches' closure sees it.
  PRODUCTS = [
    { leg:'NEAR-USD', id:'NEAR-USD', base:'NEAR', quote:'USD', name:'Near', exLabel:'Coinbase', isPerp:false },
    { leg:'INJ-USD',  id:'INJ-USD',  base:'INJ',  quote:'USD', name:'Injective', exLabel:'Coinbase', isPerp:false },
  ];
  window.loadProducts = () => Promise.resolve(PRODUCTS);
});

// t1 — dialog opens with a Spread tab.
const t1 = await p.evaluate(async () => {
  openAddSymbolDlg('SPREAD TEST');
  await new Promise(r=>setTimeout(r,50));
  return !!document.querySelector('#symTabs .symtab[data-ex="Spread"]');
});

// t2 — clicking Spread tab renders the builder (two slots, no plain symrow-only list).
const t2 = await p.evaluate(async () => {
  document.querySelector('#symTabs .symtab[data-ex="Spread"]').click();
  await new Promise(r=>setTimeout(r,50));
  return document.querySelectorAll('.sp-slot').length === 2
      && !!document.getElementById('spAdd')
      && document.getElementById('spAdd').disabled;   // disabled until both filled
});

// t3 — fill A (NEAR) then B (INJ); Add button enables with correct preview.
const t3 = await p.evaluate(async () => {
  // search NEAR → pick first row into slot A (auto-advances to B)
  const inp = document.getElementById('symInput');
  inp.value = 'NEAR'; inp.oninput();
  await new Promise(r=>setTimeout(r,30));
  chooseSpreadLeg(0);
  await new Promise(r=>setTimeout(r,30));
  inp.value = 'INJ'; inp.oninput();
  await new Promise(r=>setTimeout(r,30));
  chooseSpreadLeg(0);
  await new Promise(r=>setTimeout(r,30));
  const btn = document.getElementById('spAdd');
  return symDlgState.spread.a.leg==='NEAR-USD'
      && symDlgState.spread.b.leg==='INJ-USD'
      && btn && !btn.disabled;
});

// t4 — Add spread pushes NEAR-USD/INJ-USD and closes the dialog.
const t4 = await p.evaluate(async () => {
  document.getElementById('spAdd').click();
  await new Promise(r=>setTimeout(r,50));
  const g = GROUPS.find(x=>x.name==='SPREAD TEST');
  return g.symbols.includes('NEAR-USD/INJ-USD')
      && !symDlg.classList.contains('open');
});

const pass = t1 && t2 && t3 && t4 && errs.length===0;
console.log(JSON.stringify({ t1, t2, t3, t4, errs }, null, 2));
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);
