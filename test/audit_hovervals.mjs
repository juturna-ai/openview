import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
await page.evaluate(()=>{ Object.keys(localStorage).filter(k=>k.startsWith('fv_indicators_')).forEach(k=>localStorage.removeItem(k)); });

await page.evaluate(()=>{ addIndicator('sma'); addIndicator('rsi'); });
await page.waitForTimeout(1200);

const box=await page.locator('#draw').boundingBox();
// hover position A
await page.mouse.move(box.x+box.width*0.3, box.y+box.height*0.4);
await page.waitForTimeout(300);
const valsA = await page.locator('#indLegend .vals').first().innerText().catch(()=>'');
const subA = await page.locator('.subpane .subVals').first().innerText().catch(()=>'');
// hover position B (different x → different time)
await page.mouse.move(box.x+box.width*0.7, box.y+box.height*0.4);
await page.waitForTimeout(300);
const valsB = await page.locator('#indLegend .vals').first().innerText().catch(()=>'');
const subB = await page.locator('.subpane .subVals').first().innerText().catch(()=>'');
await page.screenshot({path:'hovervals.png'});

console.log(JSON.stringify({
  smaVal_A:valsA.trim(), smaVal_B:valsB.trim(), smaChanged: valsA!==valsB && valsA && valsB,
  rsiVal_A:subA.trim(), rsiVal_B:subB.trim(), rsiChanged: subA!==subB && subA && subB,
  appErrors:errs.slice(0,6)
},null,2));
await browser.close();
