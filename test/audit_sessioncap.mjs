import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1200,height:700});
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

// count session-break lines that WOULD draw (replicating the gated logic)
async function countBreaks(){
  return await page.evaluate(()=>{
    const cv=document.getElementById('draw'); const W=cv.clientWidth;
    if(!lastData.length || tfStepSec()>=86400) return {breaks:0,spanDays:0,gated:true};
    const t0=xToTime(0), t1=xToTime(W);
    const spanDays=(t1-t0)/86400;
    if(t0==null||t1==null||spanDays>15) return {breaks:0,spanDays:+spanDays.toFixed(1),gated:true};
    const dayOf=t=>Math.floor((t+tzOffsetMin*60)/86400);
    let prev=null,c=0;
    for(const b of lastData){ const d=dayOf(b.time); if(prev!==null&&d!==prev){ const x=timeToX(b.time); if(x!=null&&x>=0&&x<=W)c++; } prev=d; }
    return {breaks:c,spanDays:+spanDays.toFixed(1),gated:false};
  });
}

// 4h zoomed out (full history) → should be gated (0 breaks)
await page.evaluate(()=>selectTF('4h')); await page.waitForTimeout(3500);
const zoomOut4h=await countBreaks();
await page.screenshot({path:'sessioncap_4h_out.png'});

// 4h zoomed IN to ~5 days → breaks should appear
await page.evaluate(()=>{ const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange(); if(r){ const to=r.to; ts.setVisibleLogicalRange({from:to-30,to}); } });
await page.waitForTimeout(1500);
const zoomIn4h=await countBreaks();
await page.screenshot({path:'sessioncap_4h_in.png'});

console.log(JSON.stringify({zoomOut4h,zoomIn4h},null,2));
await browser.close();
