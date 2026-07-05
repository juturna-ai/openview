import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1400,height:800});
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

// Count lines drawTimeGrid would draw, reusing the live helpers on the page.
async function countGrid(){
  return await page.evaluate(()=>{
    const cv=document.getElementById('draw');
    const W=cv.clientWidth;
    const t0=xToTime(0), t1=xToTime(W);
    if(t0==null||t1==null||!(t1>t0)) return {n:0,step:null,span:t1-t0};
    const span=t1-t0;
    const STEPS=[60,120,300,600,900,1800,3600,7200,10800,21600,43200,86400,172800,604800,1209600,2592000,7776000,15552000,31536000];
    let step=STEPS[STEPS.length-1];
    for(const s of STEPS){ if(span/s <= 10*1.5){ step=s; break; } }
    const off=tzOffsetMin*60;
    let t=Math.ceil((t0+off)/step)*step - off, n=0;
    for(; t<=t1; t+=step){ const x=timeToX(t); if(x!=null&&x>=0&&x<=W) n++; }
    return {n,step,span:Math.round(span)};
  });
}

// 1d (default)
const d1=await countGrid();
await page.screenshot({path:'timegrid_1d.png'});

// 1m zoomed out
await page.evaluate(()=>selectTF('1m')); await page.waitForTimeout(4000);
// zoom out: widen visible logical range
await page.evaluate(()=>{ const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange(); if(r){ const mid=(r.from+r.to)/2, span=(r.to-r.from)*4; ts.setVisibleLogicalRange({from:mid-span/2,to:mid+span/2}); } });
await page.waitForTimeout(1500);
const m1=await countGrid();
await page.screenshot({path:'timegrid_1m_zoomout.png'});

console.log(JSON.stringify({d1,m1_zoomout:m1,appErrors:errs.slice(0,6)},null,2));
await browser.close();
