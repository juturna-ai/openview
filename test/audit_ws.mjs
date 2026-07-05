import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);

// switch to a plain Coinbase symbol so WS applies to a single product
await page.evaluate(()=>{ activeSymbol='BTC-USD'; loadChart('BTC-USD', activeTF); });
await page.waitForTimeout(5000);   // let chart load + WS connect + tick

const wsState = await page.evaluate(()=>({
  hasWs: !!_ws,
  readyState: _ws? _ws.readyState : null,       // 1 = OPEN
  syms: _wsSyms,
  lastTicks: _wsLast,
  lastClose: lastData.length? lastData[lastData.length-1].close : null,
}));
// wait a bit more and see if _wsLast got populated (a live tick arrived)
await page.waitForTimeout(4000);
const afterTicks = await page.evaluate(()=>({ lastTicks:_wsLast, tickCount:Object.keys(_wsLast).length }));

console.log(JSON.stringify({wsState, afterTicks, appErrors:errs.slice(0,6)},null,2));
await browser.close();
