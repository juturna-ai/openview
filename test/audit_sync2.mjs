import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
await page.evaluate(()=>{ try{localStorage.removeItem('fv_layout');}catch(e){} buildGrid('2h'); });
await page.waitForTimeout(9000);  // generous wait for both iframe apps to fully boot + load data

const res = await page.evaluate(()=>{
  const frames=document.querySelectorAll('#chartGrid iframe');
  if(frames.length<2) return {err:'frames '+frames.length};
  const w0=frames[0].contentWindow, w1=frames[1].contentWindow;
  const info={ p0embed:w0.IS_EMBED, p1embed:w1.IS_EMBED, p0chart:!!w0.chart, p1chart:!!w1.chart, p0data:(w0.lastData||[]).length, p1data:(w1.lastData||[]).length };
  if(!w1.chart){ return {info, note:'panel1 chart not ready'}; }
  // patch panel1 setCrosshairPosition to observe
  let hit=0; const orig=w1.chart.setCrosshairPosition.bind(w1.chart);
  w1.chart.setCrosshairPosition=(...a)=>{ hit++; return orig(...a); };
  // fire a crosshair message TO the host as panel0 would (host relays to panel1)
  const t = w0.lastData && w0.lastData.length ? w0.lastData[Math.floor(w0.lastData.length/2)].time : Math.floor(Date.now()/1000);
  window.postMessage({fvx:'crosshair', time:t}, '*');   // host receives → relays to both panels (source check skips none here)
  return {info, t, hitImmediate:hit};
});
await page.waitForTimeout(500);
const hitAfter = await page.evaluate(()=>{
  const w1=document.querySelectorAll('#chartGrid iframe')[1].contentWindow;
  return w1.__xhairHits!==undefined ? w1.__xhairHits : 'n/a';
});
console.log(JSON.stringify({res}, null, 2));
await browser.close();
