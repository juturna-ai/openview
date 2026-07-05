import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(4500);
// wrap setData to observe the pushed array length for the compare series
const len = await p.evaluate(async ()=>{
  let captured=0;
  const orig=chart.addLineSeries.bind(chart);
  // add compare and intercept its setData
  addCompare('BTC-USD');
  const c=COMPARE['BTC-USD'];
  const os=c.series.setData.bind(c.series);
  c.series.setData=arr=>{ captured=arr.length; return os(arr); };
  // trigger a reload to capture
  await loadCompareData('BTC-USD');
  await new Promise(r=>setTimeout(r,2500));
  return captured;
});
await p.waitForTimeout(1500);
await p.screenshot({path:'compare_final.png'});
console.log(JSON.stringify({comparePoints:len, appErrors:errs.slice(0,4)}));
await b.close();
