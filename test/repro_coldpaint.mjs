// Measures COLD (uncached) first-page paint latency for a never-seen TF, and
// confirms the progressive first-page paint still fires (not blocked by full load).
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.goto("http://127.0.0.1:5501/", { waitUntil: "domcontentloaded", timeout: 20000 });
await p.waitForFunction(() => typeof lastData !== 'undefined' && lastData.length > 0, { timeout: 20000 });

await p.evaluate(() => {
  window.__renders = [];
  const orig = window.renderData;
  window.renderData = function(data, keepView){
    window.__renders.push({ tf: activeTF, len: data?data.length:0, keepView: !!keepView, t: performance.now() });
    return orig.apply(this, arguments);
  };
});
const tfSteps = await p.evaluate(() => { const o={}; for(const k of Object.keys(TF)) o[k]=(TF[k].bucket||TF[k].base||86400); return o; });

// pick a TF unlikely to be cached: 30m
const tf = "30m";
await p.evaluate((tf)=>{ window.__renders=[]; window.__t0=performance.now(); selectTF(tf); }, tf);
// wait for FIRST paint of any kind
await p.waitForFunction(()=>window.__renders.length>0, { timeout: 20000 });
const firstPaint = await p.evaluate(()=>{ const r=window.__renders[0]; return { dt: r.t - window.__t0, len: r.len }; });
console.log(`cold ${tf}: first paint after ${Math.round(firstPaint.dt)}ms with ${firstPaint.len} bars`);

// now switch away and back — should be instant from cache
await p.waitForTimeout(6000);
await p.evaluate(()=>selectTF("1d")); await p.waitForTimeout(1500);
await p.evaluate((tf)=>{ window.__renders=[]; window.__t0=performance.now(); selectTF(tf); }, tf);
await p.waitForFunction(()=>window.__renders.length>0, { timeout: 5000 });
const warm = await p.evaluate(()=>{ const r=window.__renders[0]; return { dt: r.t - window.__t0, len: r.len }; });
console.log(`warm ${tf}: first paint after ${Math.round(warm.dt)}ms with ${warm.len} bars`);
console.log(warm.dt < 100 ? "INSTANT re-switch ✓" : "still slow ✗");
await b.close();
process.exit(0);
