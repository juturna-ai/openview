import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// add a drawing + indicators via API
await p.evaluate(()=>{
  snapshotDraw();
  draw.shapes.push({id:newId(), type:'trend', pts:[{time:lastData[10].time,price:0.3},{time:lastData[50].time,price:0.4}], style:{...DEFAULT_STYLE}});
  persist(); redraw();
  addIndicator('rsi'); addIndicator('macd');
});
await p.waitForTimeout(800);
// open object tree
await p.locator('#btnObjTree').click(); await p.waitForTimeout(400);
const visible=await p.evaluate(()=>{ const o=document.getElementById('objTree'); return o && o.style.display==='block'; });
const drawRows=await p.locator('#objTree .ot-row[data-kind="draw"]').count();
const indRows=await p.locator('#objTree .ot-row[data-kind="ind"]').count();
// delete the drawing via the tree
const drawCountBefore=await p.evaluate(()=>draw.shapes.length);
await p.locator('#objTree .ot-row[data-kind="draw"] .ot-x').first().click();
await p.waitForTimeout(300);
const drawCountAfter=await p.evaluate(()=>draw.shapes.length);
await p.screenshot({path:'objtree.png'});
console.log(JSON.stringify({visible, drawRows, indRows, deleted: drawCountAfter===drawCountBefore-1, appErrors:errs.slice(0,4)}));
await b.close();
