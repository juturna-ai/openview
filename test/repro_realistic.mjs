// Realistic user flow: user flips through TFs. First visit to each is network-bound;
// every subsequent visit must be instant (cache). Measures both, spaced out so we
// don't self-inflict 429s the way a rapid-fire test does.
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto("http://127.0.0.1:5501/", { waitUntil: "domcontentloaded", timeout: 20000 });
await p.waitForFunction(() => typeof lastData !== 'undefined' && lastData.length > 0, { timeout: 20000 });
await p.evaluate(() => { window.__renders=[]; const o=window.renderData; window.renderData=function(d,k){ window.__renders.push({step:d&&d.length>2?d[d.length-1].time-d[d.length-2].time:null,t:performance.now(),keepView:!!k}); return o.apply(this,arguments); }; });
const tfSteps = await p.evaluate(() => { const o={}; for(const k of Object.keys(TF)) o[k]=(TF[k].bucket||TF[k].base||86400); return o; });

async function firstCorrectMs(tf){
  const exp = tfSteps[tf];
  await p.evaluate((tf)=>{ window.__renders=[]; window.__t0=performance.now(); selectTF(tf); }, tf);
  const deadline = Date.now()+20000;
  while(Date.now()<deadline){
    const r = await p.evaluate(()=>window.__renders.map(x=>({...x})));
    const hit = r.find(x=>x.step===exp && !x.keepView);
    if(hit){ const t0=await p.evaluate(()=>window.__t0); return hit.t-t0; }
    await p.waitForTimeout(50);
  }
  return null;
}

console.log("First visit (network-bound), then wait, then revisit (must be instant):");
const tfs = ["1h","4h","15m","30m"];
let allWarmInstant = true;
for(const tf of tfs){
  const cold = await firstCorrectMs(tf);
  await p.waitForTimeout(4000);  // realistic dwell — lets Coinbase throttle reset between switches
}
// second pass — everything cached now
console.log("\n-- second pass (all cached) --");
for(const tf of tfs){
  const warm = await firstCorrectMs(tf);
  const ok = warm!=null && warm < 150;
  if(!ok) allWarmInstant = false;
  console.log(`  ${tf.padEnd(4)} revisit → ${warm==null?"NEVER":Math.round(warm)+"ms"} ${ok?"✓ instant":"✗"}`);
  await p.waitForTimeout(300);
}
console.log("\n"+(allWarmInstant ? "PASS: every revisit is instant ✓" : "FAIL ✗"));
await b.close();
process.exit(0);
