import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// in flyout categories? draw elliott via clicks
const box=await p.locator('#draw').boundingBox();
async function drawMulti(tool, n){
  await p.evaluate(t=>selectTool(t), tool);
  const cx=box.x+box.width*0.25, cy=box.y+box.height*0.5;
  for(let i=0;i<n;i++){ await p.mouse.click(cx+i*40, cy+(i%2?-30:30)); await p.waitForTimeout(120); }
}
await drawMulti('elliott', 6);
await p.waitForTimeout(300);
const afterElliott=await p.evaluate(()=>({count:draw.shapes.length, last:draw.shapes[draw.shapes.length-1]?.type, pts:draw.shapes[draw.shapes.length-1]?.pts.length}));
await drawMulti('xabcd', 5);
await p.waitForTimeout(300);
const afterXabcd=await p.evaluate(()=>({count:draw.shapes.length, last:draw.shapes[draw.shapes.length-1]?.type, pts:draw.shapes[draw.shapes.length-1]?.pts.length}));
// are they in the flyout category?
const inFlyout=await p.evaluate(()=>{ const cat=TOOL_CATEGORIES.find(c=>c.id==='patterns'); return cat.tools.includes('elliott')&&cat.tools.includes('xabcd'); });
await p.screenshot({path:'elliott.png'});
console.log(JSON.stringify({afterElliott, afterXabcd, inFlyout, appErrors:errs.slice(0,4)}));
await b.close();
