import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const box = await page.locator('#draw').boundingBox();
const cx=box.x+box.width*0.45, cy=box.y+box.height*0.5;

// helper to draw a trend line via toolbar then drag on canvas
async function drawTrend(dx,dy){
  await page.locator('.tool[data-tool="trend"]').click();
  await page.mouse.move(cx,cy); await page.mouse.down();
  await page.mouse.move(cx+dx,cy+dy,{steps:5}); await page.mouse.up();
  await page.waitForTimeout(250);
}

// 1) STAY MODE: enable, draw two lines without re-picking the tool
await page.locator('.tool[data-tool="stay"]').click();
const stayOn = await page.evaluate(()=>draw.stay);
await drawTrend(80,-40);
const toolAfter1 = await page.evaluate(()=>draw.tool);   // should still be "trend" (stay on)
await page.mouse.move(cx+10,cy+10); await page.mouse.down(); await page.mouse.move(cx+90,cy-20,{steps:5}); await page.mouse.up();
await page.waitForTimeout(250);
const countAfterStay = await page.evaluate(()=>draw.shapes.length);

// turn stay off, draw one more → should revert to cross after
await page.locator('.tool[data-tool="stay"]').click();
await drawTrend(60,50);
const toolAfterNoStay = await page.evaluate(()=>draw.tool);  // should be "cross"
const countTotal = await page.evaluate(()=>draw.shapes.length);

// 2) UNDO / REDO
const beforeUndo = await page.evaluate(()=>draw.shapes.length);
await page.keyboard.press('Control+z');
const afterUndo1 = await page.evaluate(()=>draw.shapes.length);
await page.keyboard.press('Control+z');
const afterUndo2 = await page.evaluate(()=>draw.shapes.length);
await page.keyboard.press('Control+y');
const afterRedo = await page.evaluate(()=>draw.shapes.length);

// 3) PER-DRAWING LOCK: lock first shape via API path (context menu handler), then try drag+delete
const locked = await page.evaluate(()=>{
  const s=draw.shapes[0]; if(!s) return null;
  snapshotDraw(); s.locked=true; persist(); redraw();
  draw.sel=s.id;
  return {id:s.id, locked:s.locked};
});
// attempt delete of locked selected shape
const cntBeforeDel = await page.evaluate(()=>draw.shapes.length);
await page.keyboard.press('Delete');
await page.waitForTimeout(150);
const cntAfterDel = await page.evaluate(()=>draw.shapes.length);

await page.screenshot({path:'drawtools.png'});
console.log(JSON.stringify({
  stayOn, toolAfter1_shouldBeTrend:toolAfter1, countAfterStay,
  toolAfterNoStay_shouldBeCross:toolAfterNoStay, countTotal,
  beforeUndo, afterUndo1, afterUndo2, afterRedo,
  locked, lockedDeleteBlocked: cntBeforeDel===cntAfterDel, cntBeforeDel, cntAfterDel,
  appErrors:errs.slice(0,6)
},null,2));
await browser.close();
