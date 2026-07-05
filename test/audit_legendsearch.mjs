import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

// OHLC legend shows change% on load (latest bar)?
const ohlcHTML = await page.locator('#ohlc').innerHTML();
const hasChangePct = /%/.test(ohlcHTML);

// symbolBox click → opens symbol search dialog
await page.locator('#symbolBox').click(); await page.waitForTimeout(500);
// dialog should be visible — check for the symbol dialog / search input
const dlgOpen = await page.evaluate(()=>{
  const d=document.getElementById('symDlg');
  return d ? getComputedStyle(d).display!=='none' : false;
});
const searchInputVisible = await page.locator('#symDlg input, .symdlg input').first().isVisible().catch(()=>false);
await page.screenshot({path:'legendsearch.png'});

console.log(JSON.stringify({ohlcHTML: ohlcHTML.slice(0,200), hasChangePct, dlgOpen, searchInputVisible, appErrors:errs.slice(0,6)},null,2));
await browser.close();
