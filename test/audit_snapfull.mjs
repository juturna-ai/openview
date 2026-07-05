import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({acceptDownloads:true});
const page=await ctx.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const btnSnap=await page.locator('#btnSnap').count();
const btnFull=await page.locator('#btnFull').count();

// SCREENSHOT: click, capture download, verify it's a PNG with size
const [ dl ] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#btnSnap').click(),
]);
const p=await dl.path();
const fs=await import('fs');
const buf=fs.readFileSync(p);
const isPNG = buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4e && buf[3]===0x47;
const fname=dl.suggestedFilename();

// FULLSCREEN: calling requestFullscreen headless throws/rejects but shouldn't crash the app.
// Verify the handler runs and no uncaught error surfaces.
const fsResult=await page.evaluate(()=>{ try{ toggleFullscreen(); return 'called'; }catch(e){ return 'THREW: '+e.message; } });
await page.waitForTimeout(300);

console.log(JSON.stringify({btnSnap,btnFull,isPNG,pngBytes:buf.length,fname,fsResult,appErrors:errs.slice(0,6)},null,2));
await browser.close();
