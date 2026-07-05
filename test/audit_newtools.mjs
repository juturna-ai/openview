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

// menu presence
const toolKeys=await page.evaluate(()=>Array.from(document.querySelectorAll('.tool[data-tool]')).map(e=>e.dataset.tool));
const have=['regression','gannbox','circle','arrowmark'].map(k=>({k,present:toolKeys.includes(k)}));

async function drawTool(key,dx,dy,twoClick=true){
  await page.locator(`.tool[data-tool="${key}"]`).click();
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
await page.locator('.tool[data-tool="arrowmark"]').click();
await page.mouse.click(cx+150,cy+30);
await page.waitForTimeout(300);

const shapes=await page.evaluate(()=>draw.shapes.map(s=>({type:s.type, dir:s.dir, pts:s.pts.length})));
await page.screenshot({path:'newtools.png'});
console.log(JSON.stringify({have, before, shapesAfter:shapes, appErrors:errs.slice(0,8)},null,2));
await browser.close();
