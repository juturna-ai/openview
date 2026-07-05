import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(2000);
const info = await p.evaluate(()=>{
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(chart), 'addLineSeries');
  let err=null;
  const before = chart.addLineSeries;
  try { chart.addLineSeries = function(){ return before.apply(chart, arguments); }; } catch(e){ err=e.message; }
  return { protoWritable: d.writable, protoConfigurable: d.configurable, err, patchedNow: chart.addLineSeries !== before };
});
console.log(JSON.stringify(info));
await b.close();
