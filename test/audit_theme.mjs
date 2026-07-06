import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource|Value is null/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push('PAGEERR: '+e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);
await page.evaluate(()=>{ try{ localStorage.removeItem('fv_theme'); }catch(e){} });

const btnPresent = await page.locator('#btnTheme').count();
const bgDark = await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
// toggle to light
await page.locator('#btnTheme').click(); await page.waitForTimeout(600);
const isLight = await page.evaluate(()=>document.documentElement.classList.contains('light'));
const bgLight = await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
const chartBg = await page.evaluate(()=>{ try{ return chart.options().layout.background.color; }catch(e){ return null; } });
const saved = await page.evaluate(()=>localStorage.getItem('fv_theme'));
await page.screenshot({path:'theme_light.png'});
// reload → persists
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(3800);
const lightAfterReload = await page.evaluate(()=>document.documentElement.classList.contains('light'));
console.log(JSON.stringify({btnPresent, bgDark, isLight, bgLight, chartBg, saved, lightAfterReload, appErrors:errs.slice(0,5)},null,2));
await browser.close();
