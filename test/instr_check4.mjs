import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const logs=[];
p.on('console', m=>logs.push(m.text()));
p.on('pageerror', e=>logs.push("PAGEERROR: "+e.message));
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:5000}).catch(e=>logs.push("goto err "+e.message));
await p.waitForTimeout(500);
// Immediately after DOMContentLoaded check state
const info = await p.evaluate(()=>({
  hasLWC: typeof window.LightweightCharts,
  createChartAtDCL: window.LightweightCharts ? window.LightweightCharts.createChart.toString().slice(0,80) : null
}));
console.log("early:", JSON.stringify(info));
console.log(logs.join("\n"));
await b.close();
