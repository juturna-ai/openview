import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(2000);
const info = await p.evaluate(()=>{
  // Check the series prototype too
  const s = chart.addLineSeries();
  const proto = Object.getPrototypeOf(s);
  const d = Object.getOwnPropertyDescriptor(proto, 'setData');
  return { protoWritable: d.writable, protoConfigurable: d.configurable, ctorName: proto.constructor.name };
});
console.log(JSON.stringify(info));
await b.close();
