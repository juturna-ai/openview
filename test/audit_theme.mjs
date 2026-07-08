import { chromium } from 'playwright';
// Light theme + the #btnTheme toggle were intentionally removed (index.html: "Dark
// theme only (light theme removed)"). This guards that state: dark-only, no toggle
// button, a dark body background, and no console/page errors on load.
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource|Value is null/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push('PAGEERR: '+e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

const btnPresent = await page.locator('#btnTheme').count();      // expect 0 (removed)
const isLight = await page.evaluate(()=>document.documentElement.classList.contains('light')); // expect false
const bg = await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
// parse "rgb(r,g,b)" → dark means each channel is low
const rgb = (bg.match(/\d+/g)||[]).map(Number);
const isDarkBg = rgb.length>=3 && rgb[0]<60 && rgb[1]<60 && rgb[2]<70;
const chartBg = await page.evaluate(()=>{ try{ return chart.options().layout.background.color; }catch(e){ return null; } });

const ok = btnPresent===0 && isLight===false && isDarkBg && errs.length===0;
console.log(JSON.stringify({btnPresent, isLight, bg, isDarkBg, chartBg, appErrors:errs.slice(0,5), ok},null,2));
await browser.close();
if(!ok){ console.error('FAIL: theme toggle should be gone and app dark-only'); process.exit(1); }
console.log('PASS');
