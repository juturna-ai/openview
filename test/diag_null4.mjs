import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
let errsBase=0, errsNoWs=0;
const h=e=>{ if(String(e.message||e).includes('Value is null')) errsBase++; };
page.on('pageerror',h);
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(6000);
const onLoad=errsBase;
// Does switching to a DEEP single symbol on 1h vs staying on default matter?
// Test: switch to a small-history symbol (recent listing) vs BTC. Use ASTER-USD (short history).
errsBase=0;
await page.evaluate(()=>{ activeSymbol='ETH-USD'; activeTF='1d'; loadChart('ETH-USD','1d'); });
await page.waitForTimeout(6000);
const ethDaily=errsBase;
errsBase=0;
await page.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1m'; loadChart('BTC-USD','1m'); });
await page.waitForTimeout(6000);
const btc1m=errsBase;
console.log(JSON.stringify({onLoad, ethDaily, btc1m}));
await browser.close();
