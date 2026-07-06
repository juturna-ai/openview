// Reproduces the two reported timeframe-switch bugs:
//   (1) SLOW — switching TF takes seconds before the chart shows the new TF.
//   (2) GLITCH — after switching, the chart sometimes shows a *different* TF's
//       data (a stale render from a previous load / loadOlderHistory slips in).
//
// Strategy: instrument the page to record every renderData() call with the TF
// that was active at call-time vs. the TF the data was actually built for. Then
// rapidly switch TFs and measure (a) time from selectTF to first correct paint,
// and (b) whether any render lands with data whose bar-spacing doesn't match the
// active TF (the "different chart" symptom).
import { chromium } from 'playwright';

const URL = "http://127.0.0.1:5501/";
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
p.on('pageerror', e => { if(!/Value is null/.test(e.message)) console.log('PAGEERR:', e.message); });

await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
// wait for first chart load
await p.waitForFunction(() => typeof lastData !== 'undefined' && lastData.length > 0, { timeout: 20000 });

// Instrument: wrap renderData to log activeTF + inferred step of the data painted.
await p.evaluate(() => {
  window.__renders = [];
  const orig = window.renderData;
  window.renderData = function(data, keepView){
    let step = null;
    if (data && data.length > 2) step = data[data.length-1].time - data[data.length-2].time;
    window.__renders.push({ tf: activeTF, step, len: data ? data.length : 0, keepView: !!keepView, t: performance.now() });
    return orig.apply(this, arguments);
  };
});

// Expected bar spacing (seconds) per TF bucket, read from TF{}.
const tfSteps = await p.evaluate(() => {
  const o = {};
  for (const k of Object.keys(TF)) o[k] = (TF[k].bucket || TF[k].base || 86400);
  return o;
});

async function switchTF(tf) {
  await p.evaluate((tf) => { window.__renders = []; window.__t0 = performance.now(); selectTF(tf); }, tf);
}

// Time to first *correct* paint for a given TF.
async function measure(tf) {
  await switchTF(tf);
  const expected = tfSteps[tf];
  // wait up to 15s for a render whose step matches expected
  let firstCorrect = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await p.evaluate(() => window.__renders.map(x => ({...x})));
    const hit = r.find(x => x.step === expected && !x.keepView);
    if (hit) { firstCorrect = await p.evaluate(() => window.__t0); firstCorrect = hit.t - firstCorrect; break; }
    await p.waitForTimeout(100);
  }
  return firstCorrect;
}

// --- Test 1: latency ---
console.log("=== Latency: time from selectTF → first correct paint (ms) ===");
const seq = ["1h","4h","1d","15m","1h","1d"];
const latencies = [];
for (const tf of seq) {
  const ms = await measure(tf);
  latencies.push({ tf, ms });
  console.log(`  ${tf.padEnd(4)} → ${ms==null ? "NEVER (bug)" : Math.round(ms)+"ms"}`);
  await p.waitForTimeout(1500); // let history finish so runs are comparable
}

// --- Test 2: glitch — rapid switching, then check the FINAL painted TF matches activeTF ---
console.log("\n=== Glitch: rapid switch, check for stale/mismatched renders ===");
await p.evaluate(() => { window.__renders = []; });
// fire a burst of switches with tiny gaps so loads overlap
for (const tf of ["15m","1h","4h","1d","15m","4h"]) {
  await p.evaluate((tf)=>selectTF(tf), tf);
  await p.waitForTimeout(120);
}
const finalTF = "4h";
await p.waitForTimeout(8000); // let everything settle
const analysis = await p.evaluate((exp) => {
  const rs = window.__renders;
  const last = rs[rs.length-1] || null;
  // a "mismatch" render = data painted whose active TF differs from data's own TF
  return { total: rs.length, last, activeTF };
}, finalTF);

// Determine if the currently displayed data matches activeTF's expected step.
const displayed = await p.evaluate(() => ({
  activeTF,
  step: lastData.length>2 ? lastData[lastData.length-1].time - lastData[lastData.length-2].time : null,
}));
const expStep = tfSteps[displayed.activeTF];
const glitch = displayed.step !== expStep;
console.log(`  activeTF=${displayed.activeTF}  displayed step=${displayed.step}s  expected=${expStep}s  → ${glitch ? "MISMATCH (bug)" : "ok"}`);

const slow = latencies.some(l => l.ms == null || l.ms > 1200);
console.log("\n=== VERDICT ===");
console.log("  slow:", slow, " glitch:", glitch);
console.log(slow || glitch ? "REPRODUCED ✗" : "clean ✓");

await b.close();
process.exit(0);
