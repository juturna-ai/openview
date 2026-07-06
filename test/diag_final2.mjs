import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[];
p.on('pageerror', e=>{ if(e.message!=='Value is null') errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(13000);
async function state(){
  return await p.evaluate(()=>({vr:chart.timeScale().getVisibleLogicalRange(), ws:candle.data().filter(x=>x.open===undefined).length, clen:candle.data().length, pos:+chart.timeScale().scrollPosition().toFixed(1)}));
}
console.log("after load:", JSON.stringify(await state()));
await p.waitForTimeout(5000);
console.log("after 5s ticks:", JSON.stringify(await state()));
const box = await p.evaluate(()=>{ const c=document.querySelector('#chart').getBoundingClientRect(); return {x:Math.round(c.x),y:Math.round(c.y),width:Math.round(c.width),height:Math.round(c.height)}; });
await p.screenshot({path:'diag_final2.png', clip:box});
console.log("errors:", errs.slice(0,5));
await b.close();
