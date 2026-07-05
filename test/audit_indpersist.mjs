import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// clear any prior saved indicators for a clean test
await page.evaluate(()=>{ Object.keys(localStorage).filter(k=>k.startsWith('fv_indicators_')).forEach(k=>localStorage.removeItem(k)); });

await page.evaluate(()=>{ addIndicator('rsi'); addIndicator('macd'); addIndicator('bb'); });
await page.waitForTimeout(1000);
const before = await page.evaluate(()=>({count:indicators.length, types:indicators.map(i=>i.type), saved:localStorage.getItem('fv_indicators_'+activeSymbol)}));

// change bb params + hide macd, then reload
const bbId=await page.evaluate(()=>indicators.find(i=>i.type==='bb').id);
await page.evaluate(id=>{ const i=indicators.find(x=>x.id===id); i.params.length=30; saveIndicators(); }, bbId);
const macdId=await page.evaluate(()=>indicators.find(i=>i.type==='macd').id);
await page.evaluate(id=>toggleIndicatorHidden(id), macdId);
await page.waitForTimeout(300);

await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(4500);
const after = await page.evaluate(()=>({
  count:indicators.length, types:indicators.map(i=>i.type),
  bbLen:(indicators.find(i=>i.type==='bb')||{}).params?.length,
  macdHidden:(indicators.find(i=>i.type==='macd')||{}).hidden
}));
console.log(JSON.stringify({before:{count:before.count,types:before.types,savedExists:!!before.saved}, after, appErrors:errs.slice(0,6)},null,2));
await browser.close();
