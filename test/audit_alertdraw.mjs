import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// add a horizontal line drawing at a known price
const setup=await p.evaluate(()=>{
  const lvl=lastData[lastData.length-1].close;
  snapshotDraw();
  const id=newId();
  draw.shapes.push({id, type:'hline', pts:[{time:lastData[lastData.length-1].time, price:lvl}], style:{...DEFAULT_STYLE}});
  persist(); redraw();
  const srcs=alertSourcesWithDrawings();
  const drawSrc=srcs.find(s=>s.key.startsWith('draw:'));
  // resolve its value
  const val=drawSrc?sourceValue(drawSrc.key):null;
  return { totalSrcs:srcs.length, drawSrcKey:drawSrc&&drawSrc.key, drawSrcLabel:drawSrc&&drawSrc.label, resolvedVal:val, expectedLvl:lvl };
});
console.log(JSON.stringify({setup, matches: Math.abs(setup.resolvedVal-setup.expectedLvl)<1e-9, appErrors:errs.slice(0,4)}));
await b.close();
