// Feature test — §19 item 6: draggable panel dividers, sizes persist.
// 2h grid → 1 vertical divider; dragging it shifts the fr weights; weights persist
// in fv_layout and restore on reload; named layouts capture sizes too.
//   Run:  node test/regression_layout_dividers.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);

await p.evaluate(()=>buildGrid("2h"));
await p.waitForTimeout(2500);

// 1) One vertical divider on a 2h grid, positioned mid-grid.
const d0=await p.evaluate(()=>{
  const g=document.getElementById("chartGrid");
  const divs=[...g.querySelectorAll(".grid-div")];
  return { n:divs.length, v:divs.filter(d=>d.classList.contains("v")).length, left:divs[0]?.style.left };
});
const t1 = d0.n===1 && d0.v===1 && d0.left==="50%";

// 2) Drag the divider right → weights shift, template updates, divider moves.
const box=await p.evaluate(()=>{
  const d=document.querySelector("#chartGrid .grid-div.v");
  const r=d.getBoundingClientRect(); return {x:r.left+3, y:r.top+r.height/2};
});
await p.mouse.move(box.x,box.y); await p.mouse.down();
await p.mouse.move(box.x+200,box.y,{steps:8}); await p.mouse.up();
await p.waitForTimeout(300);
const after=await p.evaluate(()=>({
  cols:_gridSizes.cols.map(x=>+x.toFixed(3)),
  tpl:document.getElementById("chartGrid").style.gridTemplateColumns,
  left:document.querySelector("#chartGrid .grid-div.v").style.left,
  stored:JSON.parse(localStorage.getItem("fv_layout")).sizes.cols.map(x=>+x.toFixed(3)),
}));
const t2 = after.cols[0]>1.1 && after.cols[1]<0.9 && /fr/.test(after.tpl) && after.left!=="50%";
// 3) Persisted.
const t3 = Math.abs(after.stored[0]-after.cols[0])<0.01;

// 4) Sizes survive reload (grid rebuilds with stored weights).
await p.reload({waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
const rel=await p.evaluate(()=>({
  gridOn:document.documentElement.classList.contains("grid-on"),
  cols:_gridSizes?_gridSizes.cols.map(x=>+x.toFixed(3)):null,
}));
const t4 = rel.gridOn && rel.cols && rel.cols[0]>1.1;

// 5) Named layout captures sizes; loading restores them.
await p.evaluate(()=>{
  const all=JSON.parse(localStorage.getItem("fv_layouts_named")||"{}");
  all["SizeTest"]={layout:_gridLayout,panels:_gridPanels.slice(),sizes:JSON.parse(JSON.stringify(_gridSizes))};
  localStorage.setItem("fv_layouts_named",JSON.stringify(all));
  _gridSizes={cols:[1,1],rows:[1]}; applyGridSizes();      // reset…
  loadNamedLayout("SizeTest");                              // …then restore
});
await p.waitForTimeout(1500);
const named=await p.evaluate(()=>_gridSizes.cols.map(x=>+x.toFixed(3)));
const t5 = named[0]>1.1;

await p.evaluate(()=>{ buildGrid("1"); localStorage.removeItem("fv_layout");
  const all=JSON.parse(localStorage.getItem("fv_layouts_named")||"{}"); delete all["SizeTest"];
  localStorage.setItem("fv_layouts_named",JSON.stringify(all)); });
const t6 = errs.length===0;
console.log("t1 divider present  :",t1,JSON.stringify(d0));
console.log("t2 drag shifts fr   :",t2,JSON.stringify(after));
console.log("t3 persisted        :",t3);
console.log("t4 survives reload  :",t4,JSON.stringify(rel));
console.log("t5 named layout     :",t5,JSON.stringify(named));
console.log("t6 no errors        :",t6,errs.slice(0,3));
await b.close();
const ok=t1&&t2&&t3&&t4&&t5&&t6;
console.log(ok?"\nPASS":"\nFAIL"); process.exit(ok?0:1);
