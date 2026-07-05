import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(1000);
const info = await p.evaluate(()=>{
  const d = Object.getOwnPropertyDescriptor(LightweightCharts, 'createChart');
  return { writable: d.writable, configurable: d.configurable, hasGetSet: !!(d.get||d.set), enumerable: d.enumerable };
});
console.log(JSON.stringify(info));
await b.close();
