import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// BTC-USD 1h loads deep history
await p.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await p.waitForTimeout(9000);
const bars1h=await p.evaluate(()=>lastData.length);
// pan + zoom perf check on the big set
const t0=Date.now();
await p.evaluate(()=>{ const ts=chart.timeScale(); for(let i=0;i<10;i++){ const r=ts.getVisibleLogicalRange(); ts.setVisibleLogicalRange({from:r.from-20,to:r.to-20}); } });
const panMs=Date.now()-t0;
console.log(JSON.stringify({bars1h, over5000: bars1h>=5000, panMs, smooth: panMs<1000, appErrors:errs.slice(0,4)}));
await b.close();
