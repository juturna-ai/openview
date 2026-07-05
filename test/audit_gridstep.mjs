import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1200,height:700});
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

async function probe(tf){
  await page.evaluate(k=>selectTF(k),tf); await page.waitForTimeout(3500);
  return await page.evaluate(()=>{
    const cv=document.getElementById('draw'); const W=cv.clientWidth;
    const t0=xToTime(0), t1=xToTime(W);
    const STEPS=[60,120,300,600,900,1800,3600,7200,10800,21600,43200,86400,172800,604800,1209600,2592000,7776000,15552000,31536000];
    if(t0==null||t1==null||!(t1>t0)) return {tf:activeTF,bad:true,t0,t1};
    const span=t1-t0;
    let step=STEPS[STEPS.length-1];
    for(const s of STEPS){ if(span/s <= 10*1.5){ step=s; break; } }
    const off=tzOffsetMin*60; let t=Math.ceil((t0+off)/step)*step-off, n=0;
    for(; t<=t1; t+=step){ const x=timeToX(t); if(x!=null&&x>=0&&x<=W) n++; }
    return {tf:activeTF, spanSec:Math.round(span), spanDays:+(span/86400).toFixed(1), step, lines:n};
  });
}
const out=[];
for(const tf of ['1d','12h','6h','4h','1h','15m','1m']) out.push(await probe(tf));
console.log(JSON.stringify(out,null,2));
await browser.close();
