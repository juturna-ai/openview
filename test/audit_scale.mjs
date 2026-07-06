import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
const before=await p.evaluate(()=>{ try{ return chart.priceScale('right').options().invertScale; }catch(e){ return 'err'; } });
await p.evaluate(()=>toggleInvertScale());
await p.waitForTimeout(400);
const after=await p.evaluate(()=>chart.priceScale('right').options().invertScale);
const stateVar=await p.evaluate(()=>_scaleInverted);
// percent scale still works?
await p.evaluate(()=>setScaleMode(2)); await p.waitForTimeout(300);
const pctMode=await p.evaluate(()=>chart.priceScale('right').options().mode);
console.log(JSON.stringify({before, after, stateVar, inverted: after===true, pctMode, appErrors:errs.slice(0,4)}));
await b.close();
