import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
const railW = await page.evaluate(()=>document.getElementById('toolbar').offsetWidth);
const iconColor = await page.evaluate(()=>getComputedStyle(document.querySelector('.tool')).color);
const svgSize = await page.evaluate(()=>{ const s=document.querySelector('.tool svg'); return {w:s.getBoundingClientRect().width, h:s.getBoundingClientRect().height}; });
// click a tool → active blue
await page.locator('.tool[data-tool="trend"]').click(); await page.waitForTimeout(200);
const activeColor = await page.evaluate(()=>{ const t=document.querySelector('.tool[data-tool="trend"]'); return getComputedStyle(t).color; });
await page.screenshot({path:'stepE_leftrail.png'});
console.log(JSON.stringify({railW, iconColor, svgSize, activeColor, appErrors:errs.slice(0,5)},null,2));
await browser.close();
