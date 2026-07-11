import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1400,height:900});
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);

await page.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await page.waitForTimeout(6000);

// Throttle the network so the older-history fetch takes several seconds — this is
// the user's actual condition ("takes too much time to load"). Then a prepend
// lands mid-gesture, which is when the bounce happens.
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.emulateNetworkConditions', {
  offline:false, latency:800, downloadThroughput: 200*1024, uploadThroughput: 200*1024,
});

// Park at the extreme left edge and let any auto-prepend from THIS set settle,
// then exhaust the trigger so the NEXT prepend is the one our drag causes.
async function parkLeftAndSettle(){
  await page.evaluate(()=>{
    const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange();
    ts.setVisibleLogicalRange({from:2, to:2+(r.to-r.from)});
  });
  await page.waitForTimeout(6000);   // slow net: give the auto-prepend time to land
}
await parkLeftAndSettle();
// after this the view sits mid-series; push it back to the edge one more time so
// the drag itself is what dips from<30.
await page.evaluate(()=>{
  const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange();
  ts.setVisibleLogicalRange({from:2, to:2+(r.to-r.from)});
});
await page.waitForTimeout(300);

const before = await page.evaluate(()=>{
  const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange();
  return { from:r.from, to:r.to, span:r.to-r.from, len:lastData.length,
           loadingOlder:_loadingOlder, exhausted:_historyExhausted };
});

// REAL left pan gesture held across the slow fetch.
const y=400;
await page.mouse.move(700, y);
await page.mouse.down();
let maxTo=0;
for(let i=0;i<50;i++){
  await page.mouse.move(700 + i*10, y, {steps:1});
  await page.waitForTimeout(120);
  const t = await page.evaluate(()=>{ const r=chart.timeScale().getVisibleLogicalRange(); return r?{to:r.to,len:lastData.length}:null; });
  if(t){ const frac=t.to/t.len; if(frac>maxTo) maxTo=frac; }
}
await page.mouse.up();
await page.waitForTimeout(2000);

const after = await page.evaluate(()=>{
  const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange();
  return { from:r.from, to:r.to, span:r.to-r.from, len:lastData.length,
           loadingOlder:_loadingOlder, exhausted:_historyExhausted };
});

const grew = after.len > before.len;
// During a LEFT drag the view should stay in the past. If at ANY point during the
// gesture the right edge jumped near the newest bar, that's the visible bounce.
const bouncedDuringDrag = maxTo > 0.85;
const endedAtLatest = after.to > after.len - after.span - 10;

console.log(JSON.stringify({
  before, after, grew, prepended: after.len-before.len,
  maxRightEdgeFractionDuringDrag:+maxTo.toFixed(3),
  bouncedDuringDrag, endedAtLatest,
  verdict: (bouncedDuringDrag||endedAtLatest) ? 'BUG: bounced toward latest during/after pan'
           : (grew ? 'OK: stayed in the past through the prepend'
                   : 'NO_PREPEND (inconclusive)'),
  appErrors:errs.slice(0,6)
},null,2));
await browser.close();
