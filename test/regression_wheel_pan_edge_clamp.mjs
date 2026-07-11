import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1500,height:900});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ activeSymbol='BINANCE:NEARUSDT'; activeTF='30m'; loadChart('BINANCE:NEARUSDT','30m'); });
await p.waitForTimeout(7000);
const cdp=await p.context().newCDPSession(p);
await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:700,downloadThroughput:150*1024,uploadThroughput:150*1024});
// Trackpad-style horizontal scroll back in time (deltaX<0 pans left) — burst of
// wheel events like a fast two-finger swipe on a small TF.
let minFrom=1e9, worstVis=1e9, track=[];
await p.mouse.move(700,400);
for(let i=0;i<120;i++){
  await p.mouse.wheel(-400, 0);          // strong horizontal scroll, dominant deltaX
  await p.waitForTimeout(40);
  const s=await p.evaluate(()=>{ const r=chart.timeScale().getVisibleLogicalRange(); const len=lastData.length;
    const vis=Math.max(0,Math.min(len,Math.round(r.to))-Math.max(0,Math.round(r.from)));
    return {from:+r.from.toFixed(1),to:+r.to.toFixed(1),len,vis}; });
  if(s.from<minFrom)minFrom=s.from; if(s.vis<worstVis)worstVis=s.vis;
  if(i%20===0)track.push(s);
}
await p.waitForTimeout(2000);
const after=await p.evaluate(()=>{ const r=chart.timeScale().getVisibleLogicalRange(); return {from:+r.from.toFixed(1),to:+r.to.toFixed(1),len:lastData.length}; });
console.log(JSON.stringify({track, after, minFrom, worstVis,
  verdict: (minFrom<-3||worstVis<30)?'BUG: wheel pan dragged past oldest bar / blanked':'OK', errs:errs.slice(0,4)},null,2));
await b.close();
