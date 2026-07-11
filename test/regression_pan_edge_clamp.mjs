import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1500,height:900});
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);

const SYM = process.env.SYM || 'BINANCE:NEARUSDT';
await page.evaluate((s)=>{ activeSymbol=s; activeTF='4h'; loadChart(s,'4h'); }, SYM);
await page.waitForTimeout(8000);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.emulateNetworkConditions', {
  offline:false, latency:1000, downloadThroughput: 120*1024, uploadThroughput: 120*1024,
});

// Aggressive: repeatedly drag right (into the past) with the button held, for a
// long time, so MANY prepends land mid-gesture and the poll may fire too. Track
// the worst visible-bar count and whether the chart ever blanks.
const y=400; let worstVis=99999, everStranded=false, everShrankBelowStart=false;
let startLen=await page.evaluate(()=>lastData.length);
const track=[];
const sample = async ()=> page.evaluate(()=>{
  const r=chart.timeScale().getVisibleLogicalRange();
  const len=lastData.length;
  if(!r) return {from:0,to:0,len,vis:0};
  const vis=Math.max(0,Math.min(len,Math.round(r.to))-Math.max(0,Math.round(r.from)));
  return { from:+r.from.toFixed(1), to:+r.to.toFixed(1), len, vis };
});
// The bug = dragging the view PAST the oldest bar (from < 0) so the chart blanks.
// Right-side future whitespace (to > len) is normal and NOT the bug.
let everWentNegative=false;
const note = (s,i)=>{ if(s.vis<worstVis)worstVis=s.vis; if(s.from < -3)everWentNegative=true; if(s.len<startLen)everShrankBelowStart=true; if(i%2===0)track.push(s); };
// Repeated left-swipe gestures (press → drag left → release), the real "scroll
// back in time" motion. Slow net means prepends land BETWEEN and DURING swipes.
// Plot canvas x∈[52,1160]; price axis at far right. To view the PAST the user
// drags RIGHT (grab a candle, pull it right → older bars appear on the left).
// Press at x=180 → drag to x=980 → release; repeat to scroll deep into history.
let step=0;
for(let sw=0; sw<16; sw++){
  await page.mouse.move(180, y);
  await page.mouse.down();
  for(let i=1;i<=12;i++){
    await page.mouse.move(180 + i*70, y, {steps:1});    // 180 → ~1000, drag right = go back
    await page.waitForTimeout(80);
    note(await sample(), step++);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);                        // let the prepend land between swipes
  note(await sample(), step++);
}
await page.waitForTimeout(1500);

const after = await page.evaluate(()=>{
  const r=chart.timeScale().getVisibleLogicalRange();
  const len=lastData.length;
  const vis=Math.max(0,Math.min(len,Math.round(r.to))-Math.max(0,Math.round(r.from)));
  return { from:+r.from.toFixed(1), to:+r.to.toFixed(1), len, vis };
});

console.log(JSON.stringify({
  SYM, startLen, track, after,
  worstVisibleBarsDuringDrag: worstVis,
  everDraggedPastOldestBar: everWentNegative,
  everShrankBelowStart,
  verdict: (everWentNegative||everShrankBelowStart) ? 'BUG: chart dragged past the oldest bar / blanked'
           : (worstVis<30 ? 'BUG: chart nearly blanked during drag' : 'OK: chart stayed populated'),
  appErrors:errs.slice(0,6)
},null,2));
await browser.close();
