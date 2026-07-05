import { chromium } from 'playwright';
const URL='http://127.0.0.1:5501/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
for(const t of ['renko','kagi','pnf','linebreak']){
  await page.evaluate(t=>setChartType(t),t); await page.waitForTimeout(1000);
  await page.screenshot({path:`ct2_${t}.png`});
}
// switch back to candles to confirm MAs restore
await page.evaluate(()=>setChartType('candles')); await page.waitForTimeout(1000);
await page.screenshot({path:`ct2_back_candles.png`});
console.log(JSON.stringify({appErrors:errs.slice(0,8)},null,2));
await browser.close();
