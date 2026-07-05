import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const allLogs=[]; const errs=[];
p.on('console', m=>{ allLogs.push(m.type()+": "+m.text()); });
p.on('pageerror', e=>errs.push(e.message));
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await p.waitForTimeout(6000);
console.log("pageerrors:", errs.length, JSON.stringify(errs));
console.log("total console msgs:", allLogs.length);
console.log(allLogs.filter(l=>l.includes('BADDATA')||l.toLowerCase().includes('error')).join("\n"));
// sanity check patch installed
const patched = await p.evaluate(()=> chart.addLineSeries.toString().includes('scan') || chart.addLineSeries.toString().length);
console.log("addLineSeries fn length:", patched);
await b.close();
