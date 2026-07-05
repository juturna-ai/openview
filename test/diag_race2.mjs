import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
let errs=0; page.on('pageerror',e=>{ if(String(e.message).includes('Value is null')) errs++; });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
for(let i=0;i<6;i++){ const s=i%2?'BTC-USD':'ETH-USD'; await page.evaluate(x=>{activeSymbol=x;loadChart(x,'1h');},s); await page.waitForTimeout(1200); }
await page.waitForTimeout(3000);
const withWs=errs; errs=0;
// kill the socket + block reconnect so no candle.update from ticks
await page.evaluate(()=>{ try{_ws&&_ws.close();}catch(e){} _historyExhausted=true; window.WebSocket=function(){ throw new Error('ws disabled'); }; });
for(let i=0;i<6;i++){ const s=i%2?'BTC-USD':'ETH-USD'; await page.evaluate(x=>{activeSymbol=x;loadChart(x,'1h');},s); await page.waitForTimeout(1200); }
await page.waitForTimeout(3000);
const noWs=errs;
console.log(JSON.stringify({errWithWs:withWs, errWithoutWs:noWs}));
await browser.close();
