import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const catBtns = await page.locator('.tool.cat').count();
const arrows = await page.locator('.tool .catarrow').count();
const bottomToggles = await page.locator('.tool[data-tool="magnet"], .tool[data-tool="lock"], .tool[data-tool="hide"], .tool[data-tool="stay"], .tool[data-tool="clear"]').count();

await page.locator('.tool.cat[data-cat="lines"] .catarrow').click();
await page.waitForTimeout(300);
const flyoutOpen = await page.locator('#toolFlyout').count();
const flyoutRows = await page.locator('#toolFlyout .tfrow').count();
const flyoutNames = await page.locator('#toolFlyout .tfn').allInnerTexts();

// select "Ray" (exact) from flyout
await page.locator('#toolFlyout .tfrow .tfn', {hasText:/^Ray$/}).click();
await page.waitForTimeout(300);
const activeTool = await page.evaluate(()=>draw.tool);
const catNowRay = await page.evaluate(()=>document.querySelector('.tool.cat[data-cat="lines"]').dataset.tool);
const catActive = await page.evaluate(()=>document.querySelector('.tool.cat[data-cat="lines"]').classList.contains('active'));

await page.locator('.tool[data-tool="magnet"]').click();
await page.waitForTimeout(200);
const magnetOn = await page.evaluate(()=>draw.magnet);

await page.screenshot({path:'stepF_flyout.png'});
console.log(JSON.stringify({catBtns, arrows, bottomToggles, flyoutOpen, flyoutRows, flyoutNames:flyoutNames.slice(0,4), activeTool, catNowRay, catActive, magnetOn, appErrors:errs.slice(0,6)},null,2));
await browser.close();
