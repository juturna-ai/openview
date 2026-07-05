import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);
const nearErrs=errs.length;   // default NEAR ratio on 1d
// now BTC 1h
await p.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await p.waitForTimeout(6000);
const afterBtc=errs.length;
console.log(JSON.stringify({nearDefaultErrs:nearErrs, btcErrsAdded: afterBtc-nearErrs}));
await b.close();
