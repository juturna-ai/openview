import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

const barPresent = await page.locator('#bottomBar').count();
const rangeCount = await page.locator('#rangeShortcuts .rng').count();
const rangeLabels = await page.locator('#rangeShortcuts .rng').allInnerTexts();
// tz + scale relocated into bottomRight?
const tzInBottom = await page.evaluate(()=>{ const b=document.getElementById('bottomRight'); const tz=document.getElementById('tzSel'); return b&&tz&&b.contains(tz); });
const scaleInBottom = await page.evaluate(()=>{ const b=document.getElementById('bottomRight'); const s=document.getElementById('btnScale'); return b&&s&&b.contains(s); });
const topbarHasTz = await page.evaluate(()=>{ const t=document.getElementById('topbar'); const tz=document.getElementById('tzSel'); return t&&tz&&t.contains(tz); });

// click "1M" range → visible span should shrink
const span0=await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange(); return r?r.to-r.from:null;});
await page.locator('#rangeShortcuts .rng', {hasText:'1M'}).click();
await page.waitForTimeout(600);
const span1=await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange(); return r?r.to-r.from:null;});
await page.screenshot({path:'stepD_bottombar.png'});

console.log(JSON.stringify({barPresent, rangeCount, rangeLabels, tzInBottom, scaleInBottom, topbarHasTz, span0:Math.round(span0), span1:Math.round(span1), rangeZoomed: span1<span0, appErrors:errs.slice(0,6)},null,2));
await browser.close();
