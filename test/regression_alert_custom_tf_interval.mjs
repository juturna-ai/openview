// Regression: an indicator alert pinned to a CUSTOM timeframe (TF key "c<sec>") must
// keep that interval when its dialog is reopened. Before the fix, the interval <select>
// filtered out custom-TF keys (k[0]!=="c"), so the pinned custom TF had no matching
// <option>; the browser defaulted to the first standard TF, and Save silently rewrote
// a.interval. After the fix, the pinned custom interval appears and stays selected.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const URL = process.env.FV_URL || 'http://127.0.0.1:5599/index.html';

const b = await chromium.launch({ headless: true });
const p = await b.newContext({ viewport:{width:1400,height:900} }).then(c=>c.newPage());
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(URL, { waitUntil:'domcontentloaded', timeout:20000 });
await p.waitForTimeout(4500);

const r = await p.evaluate(async ()=>{
  // Ensure a custom TF exists in TF{} (key form "c<sec>"). 45m = c2700 — register it the
  // same way applyCustomTF does so the dialog sees a real custom entry.
  const customKey = 'c2700';
  if(!TF[customKey]) TF[customKey] = { label:'45m', menu:'45m (custom)', sec:'CUSTOM', base:2700, bucket:2700, pages:20 };

  // Open the alert dialog editing an existing indicator alert pinned to the custom TF.
  const existing = { id:'aTEST', source:'rsi', op:'gt', target:'value', value:70,
                     interval:customKey, active:true };
  openAlertDialog({ existing });
  await new Promise(r=>setTimeout(r,300));
  const sel = document.getElementById('ad_interval') || document.querySelector('#alertDlg select[id*="interval"], #alertDlg #ad_interval');
  // find the interval select robustly: it's the one whose value can equal customKey
  let ivSelEl = null;
  document.querySelectorAll('#alertDlg select').forEach(s=>{ if([...s.options].some(o=>o.value===customKey)) ivSelEl=s; });
  const hasOption = !!ivSelEl && [...ivSelEl.options].some(o=>o.value===customKey);
  const selectedValue = ivSelEl ? ivSelEl.value : null;
  // clean up dialog
  const x=document.getElementById('adClose'); if(x) x.click();
  return { customKey, hasOption, selectedValue };
});

console.log(JSON.stringify({ ...r, errs:errs.slice(0,5) }, null, 2));
await b.close();

if(r.skip){ console.log('SKIP:', r.skip); process.exit(0); }
const ok = r.hasOption && r.selectedValue===r.customKey && errs.length===0;
if(!ok){ console.error('FAIL: custom-TF interval not preserved in alert dialog'); process.exit(1); }
console.log('PASS');
