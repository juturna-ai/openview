import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);
const topbarH=await page.evaluate(()=>document.getElementById('topbar').offsetHeight);
const dividers=await page.locator('#topbar .tbdiv').count();
// order of topbar buttons (visible, after tz/scale relocated out)
const order=await page.evaluate(()=>Array.from(document.getElementById('topbar').children).map(c=>c.id||c.className||c.tagName).filter(x=>x));
// chart still renders full-height?
const chartH=await page.evaluate(()=>document.getElementById('chart').offsetHeight);
const canvasCount=await page.locator('canvas').count();
await page.screenshot({path:'stepC_toolbar.png'});
console.log(JSON.stringify({topbarH, dividers, order, chartH, canvasCount, appErrors:errs.slice(0,6)},null,2));
await browser.close();
