import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// disable WS before switching
await p.evaluate(()=>{ try{ if(_ws) _ws.close(); }catch(e){}; window.__noWs=true; });
await p.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await p.waitForTimeout(6000);
console.log(JSON.stringify({errCount: errs.length, sample: errs.slice(0,2)}));
await b.close();
