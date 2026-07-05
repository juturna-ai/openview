import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(3000);
const info = await p.evaluate(()=>{
  return {
    isPatched: chart.addLineSeries.name,
    src: chart.addLineSeries.toString().slice(0,200),
    maSeriesSetDataPatched: maSeries[0].setData.toString().slice(0,200),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
