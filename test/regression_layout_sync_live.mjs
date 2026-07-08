// Feature test — §19 item 4: SYNC IN LAYOUT toggles apply LIVE across panels.
// Symbol sync: panel changes symbol → siblings load it. Interval sync: tf change
// propagates. Range sync: visible time range mirrors. Toggles off → no propagation.
//   Run:  node test/regression_layout_sync_live.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);

// 2-panel grid, all sync toggles ON
await p.evaluate(()=>{ setGridSync("symbol",true); setGridSync("interval",true); setGridSync("range",true); buildGrid("2h"); });
await p.waitForTimeout(9000);   // let both embeds boot
const frames=()=>p.frames().filter(f=>f.url().includes("embed=1"));
const f0=frames()[0], f1=frames()[1];

// 1) Symbol sync: change symbol in panel 0 → panel 1 follows.
await f0.evaluate(()=>loadChart("BTC-USD", activeTF));
await p.waitForTimeout(6000);
const sym1=await f1.evaluate(()=>activeSymbol);
const t1 = sym1==="BTC-USD";

// 2) Interval sync: change tf in panel 0 → panel 1 follows.
const tf0=await f0.evaluate(()=>activeTF);
const newTf = tf0==="1h" ? "4h" : "1h";
await f0.evaluate(t=>{ activeTF=t; loadChart(activeSymbol, t); }, newTf);
await p.waitForTimeout(6000);
const tf1=await f1.evaluate(()=>activeTF);
const t2 = tf1===newTf;

// 3) Host bookkeeping: _gridPanels updated + persisted.
const panels=await p.evaluate(()=>_gridPanels.map(x=>x.sym+"@"+x.tf));
const t3 = panels.every(x=>x==="BTC-USD@"+newTf);

// 4) Range sync: pan panel 0 → panel 1's visible range converges.
await f0.evaluate(()=>{ const r=chart.timeScale().getVisibleLogicalRange(); chart.timeScale().setVisibleLogicalRange({from:r.from-60, to:r.to-60}); });
await p.waitForTimeout(1500);
const [r0,r1]=await Promise.all([f0,f1].map(f=>f.evaluate(()=>{ const r=chart.timeScale().getVisibleRange(); return r?{from:r.from,to:r.to}:null; })));
const t4 = r0 && r1 && Math.abs(r0.from-r1.from) < (r0.to-r0.from)*0.05;

// 5) Toggle OFF symbol sync → change does NOT propagate.
await p.evaluate(()=>setGridSync("symbol",false));
await f0.evaluate(()=>loadChart("ETH-USD", activeTF));
await p.waitForTimeout(5000);
const sym1b=await f1.evaluate(()=>activeSymbol);
const t5 = sym1b==="BTC-USD";

await p.evaluate(()=>buildGrid("1"));
const t6 = errs.length===0;
console.log("t1 symbol sync :",t1,sym1);
console.log("t2 interval sync:",t2,tf1);
console.log("t3 bookkeeping :",t3,JSON.stringify(panels));
console.log("t4 range sync  :",t4,JSON.stringify({r0,r1}));
console.log("t5 off=no sync :",t5,sym1b);
console.log("t6 no errors   :",t6,errs.slice(0,3));
await b.close();
const ok=t1&&t2&&t3&&t4&&t5&&t6;
console.log(ok?"\nPASS":"\nFAIL"); process.exit(ok?0:1);
