import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const box=await page.locator('#draw').boundingBox();
const cx=box.x+box.width*0.4, cy=box.y+box.height*0.45;

// These tools live inside category flyouts (not top-level toolbar buttons). Presence
// is verified against the tool catalog + which flyout group each belongs to.
const TOOLS={
  regression:{cat:'lines',    name:'Regression Trend'},
  gannbox:   {cat:'fib',      name:'Gann Box'},
  circle:    {cat:'patterns', name:'Circle'},
  arrowmark: {cat:'patterns', name:'Arrow Marker (up/down)'},
};
const have=await page.evaluate(()=>{
  const keys=new Set();
  // TOOL_CATEGORIES holds flyout membership (each cat.id → tools[]).
  try{ (typeof TOOL_CATEGORIES!=='undefined'?TOOL_CATEGORIES:[]).forEach(g=>g.tools.forEach(t=>keys.add(t))); }catch(e){}
  return ['regression','gannbox','circle','arrowmark'].map(k=>({k,present:keys.has(k)}));
});

// Select a flyout tool the way a user does: open its category flyout, click the row.
async function selectTool(key){
  const {cat,name}=TOOLS[key];
  await page.locator(`.tool.cat[data-cat="${cat}"] .catarrow`).click();
  await page.locator('#toolFlyout').waitFor({state:'visible',timeout:5000});
  // Exact-match the tool name so e.g. "Circle" doesn't match another row substring.
  const esc=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  await page.locator('#toolFlyout .tfrow .tfn', {hasText:new RegExp('^'+esc+'$')}).click();
  await page.waitForTimeout(150);
}

async function drawTool(key,dx,dy,twoClick=true){
  await selectTool(key);
  await page.mouse.move(cx,cy); await page.mouse.down();
  if(twoClick){ await page.mouse.move(cx+dx,cy+dy,{steps:6}); }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

const before=await page.evaluate(()=>draw.shapes.length);
await drawTool('regression',120,-50);
await drawTool('gannbox',110,70);
await drawTool('circle',60,40);
// arrowmark is one-click
await selectTool('arrowmark');
await page.mouse.click(cx+150,cy+30);
await page.waitForTimeout(300);

const shapes=await page.evaluate(()=>draw.shapes.map(s=>({type:s.type, dir:s.dir, pts:s.pts.length})));
await page.screenshot({path:'newtools.png'});

// Assertions: all four tools present in the catalog, each drew a shape of its type, no errors.
const types=shapes.map(s=>s.type);
const expect=['regression','gannbox','circle','arrowmark'];
const drew=expect.filter(t=>types.includes(t));
const allPresent=have.every(h=>h.present);
const ok = allPresent && drew.length===expect.length && errs.length===0;

console.log(JSON.stringify({have, before, shapesAfter:shapes, drew, appErrors:errs.slice(0,8), ok},null,2));
await browser.close();
if(!ok){ console.error('FAIL: missing='+expect.filter(t=>!types.includes(t)).join(',')+' errors='+errs.length); process.exit(1); }
console.log('PASS');
