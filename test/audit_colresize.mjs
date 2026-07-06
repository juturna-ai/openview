import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(4500);
await p.evaluate(()=>{ try{['fv_wl_c2','fv_wl_c3','fv_wl_c4'].forEach(k=>localStorage.removeItem(k));}catch(e){} });
const grips=await p.locator('#wlCols .colgrip').count();
const w0=await p.evaluate(()=>Math.round(document.querySelector('#wlCols .c2').getBoundingClientRect().width));
// drag the Last-column grip left to widen it
const g=await p.locator('#wlCols .c2 .colgrip').boundingBox();
await p.mouse.move(g.x+2, g.y+8); await p.mouse.down();
await p.mouse.move(g.x-40, g.y+8, {steps:6}); await p.mouse.up();
await p.waitForTimeout(300);
const w1=await p.evaluate(()=>Math.round(document.querySelector('#wlCols .c2').getBoundingClientRect().width));
const rowMatches=await p.evaluate(()=>Math.round(document.querySelector('.row .last')?.getBoundingClientRect().width||0));
const saved=await p.evaluate(()=>localStorage.getItem('fv_wl_c2'));
console.log(JSON.stringify({grips, w0, w1, widened:w1>w0, rowMatches, headerRowMatch:Math.abs(rowMatches-w1)<3, saved, appErrors:errs.slice(0,4)}));
await b.close();
