import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ try{localStorage.removeItem('fv_wl_width');}catch(e){} });
// layout sanity: chart occupies left, watchlist right, no overlap/gap
const layout=await p.evaluate(()=>{
  const wl=document.getElementById('watchlist').getBoundingClientRect();
  const tb=document.getElementById('topbar').getBoundingClientRect();
  const main=document.getElementById('main').getBoundingClientRect();
  return { wlLeft:Math.round(wl.left), wlW:Math.round(wl.width), tbRight:Math.round(tb.right), mainRight:Math.round(main.right), winW:window.innerWidth };
});
// topbar right edge should meet the watchlist left edge (no big gap)
const gap = layout.wlLeft - layout.tbRight;
// grip present + drag to widen
const gripPresent=await p.locator('#wlResize').count();
const wb=await p.locator('#wlResize').boundingBox();
await p.mouse.move(wb.x+3, wb.y+wb.height/2); await p.mouse.down();
await p.mouse.move(wb.x-120, wb.y+wb.height/2, {steps:6}); await p.mouse.up();
await p.waitForTimeout(300);
const newW=await p.evaluate(()=>Math.round(document.getElementById('watchlist').getBoundingClientRect().width));
const saved=await p.evaluate(()=>localStorage.getItem('fv_wl_width'));
await p.screenshot({path:'wlresize.png'});
console.log(JSON.stringify({layout, topbarMeetsWatchlist: Math.abs(gap)<8, gripPresent, widened:newW>300, newW, saved, appErrors:errs.slice(0,4)}));
await b.close();
