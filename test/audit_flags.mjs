import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
await page.evaluate(()=>{ localStorage.removeItem('fv_flags'); });

// right-click a row → menu appears
const row = page.locator('.row[data-sym="BONK-USD"]').first();
const rb = await row.boundingBox();
await page.mouse.click(rb.x+rb.width*0.4, rb.y+rb.height/2, {button:'right'});
await page.waitForTimeout(400);
const menuItems = await page.locator('#ctxMenu .mi').allInnerTexts().catch(()=>[]);
const hasFlagItems = menuItems.filter(t=>/Flag/.test(t)).length;

// set a flag via API (menu click coords are fiddly) + verify persistence + render
await page.evaluate(()=>setSymbolFlag('BONK-USD','#ffd600'));
await page.waitForTimeout(400);
const saved = await page.evaluate(()=>localStorage.getItem('fv_flags'));
const flagStyle = await page.locator('.row[data-sym="BONK-USD"] .flag').first().getAttribute('style');

// reload → persists
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(3800);
const flagAfterReload = await page.locator('.row[data-sym="BONK-USD"] .flag').first().getAttribute('style');
await page.screenshot({path:'flags.png'});

console.log(JSON.stringify({hasFlagItems, saved, flagStyle, flagAfterReload, appErrors:errs.slice(0,6)},null,2));
await browser.close();
