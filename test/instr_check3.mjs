import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(3000);
const info = await p.evaluate(()=>({
  createChartSrc: LightweightCharts.createChart.toString().slice(0,150)
}));
console.log(JSON.stringify(info, null, 2));
await b.close();
