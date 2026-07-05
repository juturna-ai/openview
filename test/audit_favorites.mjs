import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
await page.evaluate(()=>{ localStorage.removeItem('fv_ind_favorites'); });

// open dialog
await page.locator('#btnIndicators').click(); await page.waitForTimeout(400);
const tabsPresent = await page.locator('.indtab').count();
const starCount = await page.locator('.pi .star').count();

// star the first two indicators
const stars = page.locator('.pi .star');
await stars.nth(0).click(); await page.waitForTimeout(150);
await stars.nth(3).click(); await page.waitForTimeout(150);
const favSaved = await page.evaluate(()=>localStorage.getItem('fv_ind_favorites'));

// switch to Favorites tab
await page.locator('.indtab[data-tab="favorites"]').click(); await page.waitForTimeout(300);
const favRows = await page.locator('#indList .pi').count();
const favNames = await page.locator('#indList .pinm').allInnerTexts();

// reload → favorites persist, reopen, check favorites tab still has them
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(3800);
await page.locator('#btnIndicators').click(); await page.waitForTimeout(400);
await page.locator('.indtab[data-tab="favorites"]').click(); await page.waitForTimeout(300);
const favAfterReload = await page.locator('#indList .pinm').allInnerTexts();

await page.screenshot({path:'favorites.png'});
console.log(JSON.stringify({tabsPresent, starCount, favSaved, favRows, favNames, favAfterReload, appErrors:errs.slice(0,6)},null,2));
await browser.close();
