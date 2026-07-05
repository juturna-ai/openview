import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// add RSI (subpane) + SMA (overlay) via API
await page.evaluate(()=>{ addIndicator('rsi'); addIndicator('sma'); });
await page.waitForTimeout(1200);

const paneCount = await page.locator('.subpane').count();
const eyeInPane = await page.locator('.subpane .subEye').count();
const gripCount = await page.locator('.subpane .paneResize').count();
const eyeInLegend = await page.locator('#indLegend .eye').count();

// EYE toggle on the RSI subpane
const rsiId = await page.evaluate(()=>indicators.find(i=>i.type==='rsi').id);
const hiddenBefore = await page.evaluate(id=>indicators.find(i=>i.id===id).hidden, rsiId);
await page.evaluate(id=>toggleIndicatorHidden(id), rsiId);
await page.waitForTimeout(300);
const hiddenAfter = await page.evaluate(id=>indicators.find(i=>i.id===id).hidden, rsiId);
const paneDimmed = await page.locator('.subpane.hiddenInd').count();

// PANE RESIZE: drag the grip down by 60px
const grip = page.locator('.subpane .paneResize').first();
const gb = await grip.boundingBox();
const heightBefore = await page.evaluate(()=>document.querySelector('.subpane').getBoundingClientRect().height);
await page.mouse.move(gb.x+gb.width/2, gb.y+gb.height/2); await page.mouse.down();
await page.mouse.move(gb.x+gb.width/2, gb.y+gb.height/2+70,{steps:6}); await page.mouse.up();
await page.waitForTimeout(300);
const heightAfter = await page.evaluate(()=>document.querySelector('.subpane').getBoundingClientRect().height);

await page.screenshot({path:'panehide.png'});
console.log(JSON.stringify({paneCount,eyeInPane,gripCount,eyeInLegend,hiddenBefore,hiddenAfter,paneDimmed,heightBefore:Math.round(heightBefore),heightAfter:Math.round(heightAfter),resized:Math.abs(heightAfter-heightBefore)>30,appErrors:errs.slice(0,6)},null,2));
await browser.close();
