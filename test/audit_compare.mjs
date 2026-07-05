import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

const btnPresent = await page.locator('#btnCompare').count();
// add a compare via API (prompt() blocked headless)
const added = await page.evaluate(async ()=>{ try{ addCompare('BTC-USD'); return {ok:true, keys:Object.keys(COMPARE)}; }catch(e){ return {ok:false, why:e.message}; } });
await page.waitForTimeout(3500);   // let it fetch
const chip = await page.locator('#compareLegend .indrow').count();
const chipText = await page.locator('#compareLegend .nm').innerText().catch(()=>'');
// verify the compare series actually got data
const hasData = await page.evaluate(()=>{ const c=COMPARE['BTC-USD']; return c && c.series && c.series._data ? c.series._data.length>0 : 'no _data (setData not wrapped for compare)'; });
await page.screenshot({path:'compare.png'});
// remove it
const removed = await page.evaluate(()=>{ removeCompare('BTC-USD'); return Object.keys(COMPARE).length; });

console.log(JSON.stringify({btnPresent, added, chip, chipText, hasDataOrNote:hasData, removedCount:removed, appErrors:errs.slice(0,6)},null,2));
await browser.close();
