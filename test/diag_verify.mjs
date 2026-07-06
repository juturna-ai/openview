import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[];
p.on('pageerror', e=>{ if(e.message!=='Value is null') errs.push('PAGEERR: '+e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(9000);

const box = await p.evaluate(()=>{ const c=document.querySelector('#chart').getBoundingClientRect(); return {x:c.x, y:c.y, w:c.width, h:c.height}; });

// TEST 1: try to zoom ALL the way out — bar spacing must stay readable
await p.mouse.move(box.x+box.w*0.5, box.y+box.h*0.5);
for(let i=0;i<40;i++){ await p.mouse.wheel(0, 120); await p.waitForTimeout(20); }  // wheel down = zoom out, hard
await p.waitForTimeout(1000);
const bsOut = await p.evaluate(()=>chart.timeScale().options().barSpacing);
console.log("barSpacing after zooming ALL the way out:", bsOut, bsOut>=3 ? "PASS (candles visible)" : "FAIL (sub-pixel)");

// TEST 2: oscillation check — with RSI pane present, zoom in/out and watch for flips
await p.evaluate(()=>{ window.__r=[]; chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{ if(r) window.__r.push(+r.from.toFixed(2)); }); });
for(let i=0;i<8;i++){ await p.mouse.wheel(0, -120); await p.waitForTimeout(80); }
for(let i=0;i<8;i++){ await p.mouse.wheel(0, 120); await p.waitForTimeout(80); }
await p.waitForTimeout(1500);
const rr = await p.evaluate(()=>window.__r);
let flips=0;
for(let i=2;i<rr.length;i++){ const d1=rr[i-1]-rr[i-2], d2=rr[i]-rr[i-1]; if(d1*d2<0 && Math.abs(d1)>0.05 && Math.abs(d2)>0.05) flips++; }
console.log("range events:", rr.length, "| direction flips (bounce):", flips, flips<=2?"PASS":"FAIL");

await p.screenshot({path:'diag_final.png'});
console.log("errors:", errs);
await b.close();
