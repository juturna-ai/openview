// Regression (audit): pure-logic fixes found in the 2026-07 bug audit.
//  - supertrendCalc must not throw / must return an array for any UI-permitted ATR length (incl. 1).
//  - fmtPrice must never emit the malformed "0." for sub-1e-8 values (trailing-dot strip).
// Extracts the exact function sources from index.html and exercises them in isolation.
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dir, '..', 'index.html'), 'utf8');

// Extract the exact source lines of the pure functions under test.
function grab(re){ const m=re.exec(html); if(!m) throw new Error('not found: '+re); return m[0]; }
const rmaA = grab(/function rmaA\(a,len\)\{[\s\S]*?return o; \}/);
const trA  = grab(/function trA\(data\)\{[\s\S]*?return o; \}/);
const pair = 'function pair(data,o){ return o; }'; // supertrend calls pair(); identity is fine for shape
const supertrend = grab(/function supertrendCalc\(data,atrLen,factor\)\{[\s\S]*?return pair\(data,o\)\.map\(\(p,idx\)=>p\); \}/);
const fmtPrice = grab(/function fmtPrice\(v\)\{[\s\S]*?\n\}/);

const mod = new Function(rmaA+trA+pair+supertrend+fmtPrice+
  '; return { supertrendCalc, fmtPrice };')();

let pass=0, fail=0;
const ok=(n,c)=>{ (c?pass++:fail++); console.log((c?'PASS':'FAIL')+' '+n); };

const bars=[]; for(let i=0;i<10;i++) bars.push({high:100+i,low:90+i,open:95+i,close:96+i,time:i});
let threw=false,out=null;
try{ out=mod.supertrendCalc(bars,1,3); }catch(e){ threw=true; console.log('  threw:',e.message); }
ok('supertrend atrLen=1 no throw', !threw);
ok('supertrend atrLen=1 array', Array.isArray(out));
try{ mod.supertrendCalc(bars,2,3); mod.supertrendCalc(bars,10,3); ok('supertrend atrLen=2/10 ok',true);}catch(e){ok('supertrend atrLen=2/10 ok',false);}

for(const v of [4.9e-9,1e-10,9.99e-9,5e-9]){ const s=mod.fmtPrice(v); ok(`fmtPrice(${v})=${JSON.stringify(s)} !~ "0."`, s!=='0.'&&!/\.$/.test(s)); }
ok('fmtPrice(0.00000424)', mod.fmtPrice(0.00000424)==='0.00000424');
ok('fmtPrice(1813.5)', mod.fmtPrice(1813.5)==='1,813.50');
ok('fmtPrice(0)', mod.fmtPrice(0)==='0');
ok('fmtPrice(59716)', mod.fmtPrice(59716)==='59,716.00');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
