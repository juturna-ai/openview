import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// probe: does drawSessionBreaks early-return on daily? count day-boundaries on 1h
const probe = await page.evaluate(()=>{
  // count how many day-boundary transitions exist in current (1d) data → drawSessionBreaks returns early
  const stepD = tfStepSec();
  return { tfStepDaily: stepD>=86400 };
});

// switch to 1h and screenshot (session breaks should draw)
await page.evaluate(()=>selectTF('1h')); await page.waitForTimeout(3000);
const stepH = await page.evaluate(()=>tfStepSec());
await page.screenshot({path:'sessions_1h.png'});
// count expected breaks by inspecting data
const breaks1h = await page.evaluate(()=>{
  if(tfStepSec()>=86400) return 0;
  const dayOf=t=>Math.floor((t + tzOffsetMin*60)/86400);
  let prev=null,c=0; for(const b of lastData){ const d=dayOf(b.time); if(prev!==null&&d!==prev)c++; prev=d; } return c;
});

// switch back to 1d → no breaks
await page.evaluate(()=>selectTF('1d')); await page.waitForTimeout(2500);
const dailyEarlyReturn = await page.evaluate(()=>tfStepSec()>=86400);

console.log(JSON.stringify({probe, stepH, breaks1h_expected:breaks1h, dailyEarlyReturn, appErrors:errs.slice(0,6)},null,2));
await browser.close();
