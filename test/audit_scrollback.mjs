import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
// use BTC-USD (deep Coinbase history) on 1h
await page.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await page.waitForTimeout(6000);

const before = await page.evaluate(()=>lastData.length);
const oldestBefore = await page.evaluate(()=>lastData[0].time);

// scroll to the far-left edge to trigger loadOlderHistory
await page.evaluate(()=>{ const ts=chart.timeScale(); const r=ts.getVisibleLogicalRange(); ts.setVisibleLogicalRange({from:5, to:5+(r.to-r.from)}); });
await page.waitForTimeout(4000);   // let older pages fetch + prepend

const after = await page.evaluate(()=>lastData.length);
const oldestAfter = await page.evaluate(()=>lastData[0].time);
const exhausted = await page.evaluate(()=>_historyExhausted);

console.log(JSON.stringify({
  before, after, grew: after>before, addedBars: after-before,
  oldestWentBack: oldestAfter<oldestBefore,
  exhausted, appErrors:errs.slice(0,6)
},null,2));
await browser.close();
