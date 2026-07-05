import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// switch to BTC-USD 1h WITHOUT triggering scroll-back
await p.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await p.waitForTimeout(6000);
console.log(JSON.stringify({errsWithoutScrollback: errs.slice(0,4), count: errs.length}));
await b.close();
