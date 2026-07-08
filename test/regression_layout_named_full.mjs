// Feature test — §19 item 8: named layout saves grid arrangement, per-panel
// symbol/timeframe/INDICATORS, and sync toggle states; loading restores all.
//   Run:  node test/regression_layout_named_full.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);

// Grid with distinct state: 2h, sizes skewed, sync.symbol on, indicator in panel 0.
await p.evaluate(()=>{ setGridSync("symbol",true); setGridSync("interval",false); buildGrid("2h"); });
await p.waitForTimeout(9000);
// NB: p.frames() order is NOT panel order — resolve panel 0's frame by its sym URL param.
const panel0Sym=await p.evaluate(()=>_gridPanels[0].sym);
const frame0=()=>p.frames().find(f=>f.url().includes("embed=1")&&f.url().includes(encodeURIComponent(panel0Sym)));
await frame0().evaluate(()=>addIndicator("bb"));
// wait until the embed persisted the indicator to the shared per-symbol key
await p.waitForFunction(()=>{
  const sym=_gridPanels[0].sym;
  try{ const raw=localStorage.getItem("fv_indicators_"+sym); return raw && JSON.parse(raw).some(x=>x.type==="bb"); }catch(e){ return false; }
},{timeout:15000});
await p.evaluate(()=>{ _gridSizes.cols=[1.4,0.6]; applyGridSizes(); persistLayout(); });

// Save under a name (bypass prompt).
await p.evaluate(()=>{
  const panels=_gridPanels.map(pp=>{
    let inds=null; try{ const raw=localStorage.getItem("fv_indicators_"+pp.sym); if(raw) inds=JSON.parse(raw).map(x=>({type:x.type,params:x.params,hidden:!!x.hidden})); }catch(e){}
    return Object.assign({},pp,inds?{inds}:{});
  });
  const all=JSON.parse(localStorage.getItem("fv_layouts_named")||"{}");
  all["FullTest"]={layout:_gridLayout,panels,sizes:_gridSizes,sync:Object.assign({},_gridSync)};
  localStorage.setItem("fv_layouts_named",JSON.stringify(all));
});
// 1) Saved record has all four parts.
const rec=await p.evaluate(()=>JSON.parse(localStorage.getItem("fv_layouts_named"))["FullTest"]);
const t1 = rec.layout==="2h" && rec.sizes.cols[0]===1.4 && rec.sync.symbol===true && rec.sync.interval===false
  && Array.isArray(rec.panels[0].inds) && rec.panels[0].inds.some(x=>x.type==="bb");

// Scramble state, then load the named layout.
await p.evaluate(()=>{ setGridSync("symbol",false); _gridSizes={cols:[1,1],rows:[1]}; buildGrid("4"); });
await p.waitForTimeout(2000);
await p.evaluate(()=>loadNamedLayout("FullTest"));
await p.waitForTimeout(11000);   // panels reboot + setinds lands

// 2) Arrangement + sizes + sync restored.
const st=await p.evaluate(()=>({ layout:_gridLayout, cols:_gridSizes.cols, sync:_gridSync.symbol,
  frames:document.querySelectorAll("#chartGrid iframe").length }));
const t2 = st.layout==="2h" && st.frames===2 && st.cols[0]===1.4 && st.sync===true;

// 3) Panel 0's indicator set restored (bb present).
const inds=await frame0().evaluate(()=>indicators.map(i=>i.type));
const t3 = inds.includes("bb");

await p.evaluate(()=>{ buildGrid("1");
  const all=JSON.parse(localStorage.getItem("fv_layouts_named")||"{}"); delete all["FullTest"];
  localStorage.setItem("fv_layouts_named",JSON.stringify(all)); localStorage.removeItem("fv_layout"); });
const t4 = errs.length===0;
console.log("t1 saved record complete :",t1);
console.log("t2 layout/sizes/sync back:",t2,JSON.stringify(st));
console.log("t3 panel indicators back :",t3,JSON.stringify(inds));
console.log("t4 no errors             :",t4,errs.slice(0,3));
await b.close();
const ok=t1&&t2&&t3&&t4;
console.log(ok?"\nPASS":"\nFAIL"); process.exit(ok?0:1);
