// Feature test — §19 item 5: selected panel highlight + toolbar routes to it.
// Panel gets .gsel accent border when interacted with; watchlist symbol click and
// timeframe selection apply to the SELECTED panel (all panels when sync is on).
//   Run:  node test/regression_layout_selpanel.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.setViewportSize({width:1600,height:900});
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(6000);

await p.evaluate(()=>{ setGridSync("symbol",false); setGridSync("interval",false); buildGrid("2h"); });
await p.waitForTimeout(9000);
const frames=()=>p.frames().filter(f=>f.url().includes("embed=1"));

// 1) Panel 0 selected by default (.gsel).
const sel0=await p.evaluate(()=>document.querySelector('#chartGrid iframe.gsel')?.dataset.panel);
const t1 = sel0==="0";

// 2) Interaction inside panel 1 → selection moves.
await frames()[1].evaluate(()=>document.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true})));
await p.waitForTimeout(400);
const sel1=await p.evaluate(()=>document.querySelector('#chartGrid iframe.gsel')?.dataset.panel);
const t2 = sel1==="1";

// 3) Watchlist symbol click routes to the SELECTED panel only (sync off).
await p.evaluate(()=>gridTargetSym("BTC-USD"));
await p.waitForTimeout(6000);
const [s0,s1]=await Promise.all(frames().map(f=>f.evaluate(()=>activeSymbol)));
const t3 = s1==="BTC-USD" && s0!=="BTC-USD";

// 4) selectTF routes to the selected panel only.
const tfBefore0=await frames()[0].evaluate(()=>activeTF);
await p.evaluate(()=>selectTF("4h"));
await p.waitForTimeout(6000);
const [tf0,tf1]=await Promise.all(frames().map(f=>f.evaluate(()=>activeTF)));
const t4 = tf1==="4h" && tf0===tfBefore0;

// 5) With symbol sync ON, routing hits ALL panels.
await p.evaluate(()=>{ setGridSync("symbol",true); gridTargetSym("ETH-USD"); });
await p.waitForTimeout(6000);
const syms=await Promise.all(frames().map(f=>f.evaluate(()=>activeSymbol)));
const t5 = syms.every(x=>x==="ETH-USD");

await p.evaluate(()=>buildGrid("1"));
const t6 = errs.length===0;
console.log("t1 default sel=0 :",t1,sel0); console.log("t2 sel moves →1  :",t2,sel1);
console.log("t3 sym→selected  :",t3,JSON.stringify([s0,s1]));
console.log("t4 tf→selected   :",t4,JSON.stringify([tf0,tf1]));
console.log("t5 sync→all      :",t5,JSON.stringify(syms));
console.log("t6 no errors     :",t6,errs.slice(0,3));
await b.close();
const ok=t1&&t2&&t3&&t4&&t5&&t6;
console.log(ok?"\nPASS":"\nFAIL"); process.exit(ok?0:1);
