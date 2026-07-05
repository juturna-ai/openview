import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
// draw a trend line in an area NOT under the legend (center of chart)
const box=await page.locator('#draw').boundingBox();
await page.locator('.tool.cat[data-cat="lines"]').click();  // activates trend (current)
await page.waitForTimeout(150);
const before=await page.evaluate(()=>draw.shapes.length);
const cx=box.x+box.width*0.5, cy=box.y+box.height*0.6;   // center, clear of top-left legend
await page.mouse.move(cx,cy); await page.mouse.down(); await page.mouse.move(cx+90,cy-40,{steps:5}); await page.mouse.up();
await page.waitForTimeout(300);
const after=await page.evaluate(()=>draw.shapes.length);
console.log(JSON.stringify({drewShape: after>before, before, after, appErrors:errs.slice(0,4)}));
await browser.close();
