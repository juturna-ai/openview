import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
// current symbol has rsi/macd/bb saved from prior test; switch symbol via clicking a watchlist row
const startSym=await page.evaluate(()=>activeSymbol);
const startCount=await page.evaluate(()=>indicators.length);
// click a different watchlist row (BONK)
await page.locator('.row[data-sym="BONK-USD"]').first().click().catch(()=>{});
await page.waitForTimeout(3500);
const afterSym=await page.evaluate(()=>activeSymbol);
const afterCount=await page.evaluate(()=>indicators.length);  // BONK has none saved → should be 0
await page.screenshot({path:'indpersist.png'});
console.log(JSON.stringify({startSym,startCount,afterSym,afterCount,swapped:startSym!==afterSym,appErrors:errs.slice(0,4)},null,2));
await browser.close();
