import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
let errs=0; page.on('pageerror',e=>{ if(String(e.message).includes('Value is null')) errs++; });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
// Force many rapid reloads (stresses setData vs WS update race)
for(let i=0;i<6;i++){
  const sym = i%2 ? 'BTC-USD' : 'ETH-USD';
  await page.evaluate(s=>{ activeSymbol=s; loadChart(s,'1h'); }, sym);
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(3000);
const withWs=errs;
// Now neutralize the WS candle.update path and repeat
errs=0;
await page.evaluate(()=>{ window.__killTick=true; const o=applyTick; applyTick=()=>{ if(window.__killTick) return; return o(); }; });
for(let i=0;i<6;i++){
  const sym = i%2 ? 'BTC-USD' : 'ETH-USD';
  await page.evaluate(s=>{ activeSymbol=s; loadChart(s,'1h'); }, sym);
  await page.waitForTimeout(1200);
}
await page.waitForTimeout(3000);
const noWs=errs;
console.log(JSON.stringify({errWithWs:withWs, errWithoutWsTick:noWs}));
await browser.close();
