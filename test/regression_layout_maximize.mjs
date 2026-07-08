// Feature test — §19 item 7: maximize a single panel + restore back to grid.
// Hover ⛶ button per panel; click → that panel fills the grid (others hidden),
// button becomes ❐ restore; click again → grid restored. New grid resets state.
//   Run:  node test/regression_layout_maximize.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);

await p.evaluate(()=>buildGrid("4"));
await p.waitForTimeout(2500);

// 1) One max button per panel.
const n=await p.evaluate(()=>document.querySelectorAll("#chartGrid .grid-max").length);
const t1 = n===4;

// 2) Maximize panel 2 → grid.maxed, only that iframe visible + full-size, selected.
await p.evaluate(()=>toggleGridMax(2));
await p.waitForTimeout(400);
const mx=await p.evaluate(()=>{
  const g=document.getElementById("chartGrid");
  const f2=g.querySelector('iframe[data-panel="2"]');
  const others=[...g.querySelectorAll("iframe")].filter(f=>f.dataset.panel!=="2");
  return {
    maxed:g.classList.contains("maxed"), gmax:f2.classList.contains("gmax"),
    fullW: Math.abs(f2.getBoundingClientRect().width - g.getBoundingClientRect().width) < 4,
    othersHidden: others.every(f=>getComputedStyle(f).visibility==="hidden"),
    sel:_gridSelPanel, btn:g.querySelector('.grid-max[data-panel="2"]').textContent,
  };
});
const t2 = mx.maxed && mx.gmax && mx.fullW && mx.othersHidden && mx.sel===2 && mx.btn==="❐";

// 3) Restore → grid back, all visible.
await p.evaluate(()=>toggleGridMax(2));
await p.waitForTimeout(400);
const rs=await p.evaluate(()=>{
  const g=document.getElementById("chartGrid");
  return { maxed:g.classList.contains("maxed"),
    allVisible:[...g.querySelectorAll("iframe")].every(f=>getComputedStyle(f).visibility!=="hidden") };
});
const t3 = !rs.maxed && rs.allVisible;

// 4) Rebuilding a grid resets maximize state.
await p.evaluate(()=>{ toggleGridMax(1); buildGrid("2h"); });
await p.waitForTimeout(600);
const reset=await p.evaluate(()=>({ max:_gridMax, maxed:document.getElementById("chartGrid").classList.contains("maxed") }));
const t4 = reset.max===null && !reset.maxed;

await p.evaluate(()=>buildGrid("1"));
const t5 = errs.length===0;
console.log("t1 4 max buttons :",t1,n);
console.log("t2 maximize      :",t2,JSON.stringify(mx));
console.log("t3 restore       :",t3,JSON.stringify(rs));
console.log("t4 rebuild resets:",t4,JSON.stringify(reset));
console.log("t5 no errors     :",t5,errs.slice(0,3));
await b.close();
const ok=t1&&t2&&t3&&t4&&t5;
console.log(ok?"\nPASS":"\nFAIL"); process.exit(ok?0:1);
