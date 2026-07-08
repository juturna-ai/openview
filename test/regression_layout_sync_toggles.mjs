// Feature test — §19 item 3: SYNC IN LAYOUT section in the layout picker.
// 5 toggles (Symbol/Interval/Crosshair/Time/Date range), each with an info
// tooltip; toggling persists to fv_grid_sync and survives reload; the Crosshair
// toggle drives the live _gridSyncCrosshair relay flag; the menu stays open
// while toggling. Run:  node test/regression_layout_sync_toggles.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
const r=await p.evaluate(()=>{
  document.getElementById("layoutSelBtn").click();
  const rows=[...document.querySelectorAll("#layoutMenu .lp-sync-row")];
  return { labels: rows.map(x=>x.textContent.replace("ⓘ","").trim()),
    tips: rows.every(x=>x.querySelector(".info")?.title.length>10),
    crossOn: rows.find(x=>x.dataset.sync==="crosshair")?.classList.contains("on") };
});
await p.evaluate(()=>{ document.querySelector('#layoutMenu .lp-sync-row[data-sync="symbol"]').click(); });
const r2=await p.evaluate(()=>({
  on: document.querySelector('#layoutMenu .lp-sync-row[data-sync="symbol"]').classList.contains("on"),
  stillOpen: document.getElementById("layoutSel").classList.contains("open"),
  stored: JSON.parse(localStorage.getItem("fv_grid_sync")||"{}") }));
await p.evaluate(()=>{ document.querySelector('#layoutMenu .lp-sync-row[data-sync="crosshair"]').click(); });
const cross=await p.evaluate(()=>_gridSyncCrosshair);
await p.reload({waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
const r3=await p.evaluate(()=>{
  document.getElementById("layoutSelBtn").click();
  return { symbolOn: document.querySelector('#layoutMenu .lp-sync-row[data-sync="symbol"]').classList.contains("on"),
    crossOn: document.querySelector('#layoutMenu .lp-sync-row[data-sync="crosshair"]').classList.contains("on"),
    liveVar: _gridSyncCrosshair };
});
const ok = r.labels.join(",")==="Symbol,Interval,Crosshair,Time,Date range" && r.tips && r.crossOn===true
  && r2.on && r2.stillOpen && r2.stored.symbol===true && cross===false
  && r3.symbolOn===true && r3.crossOn===false && r3.liveVar===false && errs.length===0;
console.log(JSON.stringify({r,r2,cross,r3,errs}));
console.log(ok?"PASS":"FAIL"); await b.close(); process.exit(ok?0:1);
