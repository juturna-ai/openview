import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const errs=[];
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// switch symbol to BONK and TF to 4h
await page.locator('.row[data-sym="BONK-USD"]').first().click().catch(()=>{});
await page.waitForTimeout(2500);
await page.evaluate(()=>selectTF('4h'));
await page.waitForTimeout(2500);
const before=await page.evaluate(()=>({sym:activeSymbol, tf:activeTF, savedSym:localStorage.getItem('fv_active_symbol'), savedTf:localStorage.getItem('fv_active_tf')}));

// reload → should land on BONK 4h
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(4500);
const after=await page.evaluate(()=>({sym:activeSymbol, tf:activeTF}));

// also test a custom TF restore
await page.evaluate(()=>applyCustomTF('45m'));
await page.waitForTimeout(2500);
const customBefore=await page.evaluate(()=>activeTF);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(4500);
const customAfter=await page.evaluate(()=>({tf:activeTF, tfExists:!!TF[activeTF]}));

console.log(JSON.stringify({before, after, restored:before.sym===after.sym&&before.tf===after.tf, customBefore, customAfter, appErrors:errs.slice(0,6)},null,2));
await browser.close();
