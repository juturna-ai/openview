import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(3000);
const info = await p.evaluate(()=>{
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(chart), 'addLineSeries');
  const ownDesc = Object.getOwnPropertyDescriptor(chart, 'addLineSeries');
  let assignErr=null;
  try{ chart.addLineSeries = function(){return "patched";}; }catch(e){ assignErr=e.message; }
  return {
    protoDesc: desc ? {writable:desc.writable, configurable:desc.configurable, hasGetter: !!desc.get} : null,
    ownDesc,
    assignErr,
    afterAssign: chart.addLineSeries.toString().slice(0,50)
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
