import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// switch to an intraday TF so time labels show hours
await page.evaluate(()=>selectTF('1h')); await page.waitForTimeout(3000);

// pure-logic check: tickLabel time output for a known epoch under UTC vs Tokyo
const probe = await page.evaluate(()=>{
  const t = 1751328000; // 2025-07-01 00:00 UTC (a round hour)
  tzOffsetMin=0;  const utc = tickLabel(t,3);
  tzOffsetMin=540; const tok = tickLabel(t,3);
  tzOffsetMin=-300; const ny = tickLabel(t,3);
  tzOffsetMin=0;
  return {utc,tok,ny, cross_utc:(tzOffsetMin=0,crosshairTimeFmt(t)), cross_tok:(tzOffsetMin=540,crosshairTimeFmt(t))};
});

// UI: dropdown present + apply Tokyo + label updates + persists
const tzBtnVisible = await page.locator('#tzSelBtn').isVisible();
await page.locator('#tzSelBtn').click(); await page.waitForTimeout(200);
await page.locator('#tzMenu .tf-opt', {hasText:'Tokyo'}).click();
await page.waitForTimeout(500);
const labelAfter = await page.locator('#tzSelLabel').innerText();
const savedTz = await page.evaluate(()=>localStorage.getItem('fv_tz'));
await page.screenshot({path:'tz_tokyo.png'});

// reload → persists
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(3500);
const labelReload = await page.locator('#tzSelLabel').innerText();

console.log(JSON.stringify({probe,tzBtnVisible,labelAfter,savedTz,labelReload,appErrors:errs.slice(0,6)},null,2));
await browser.close();
