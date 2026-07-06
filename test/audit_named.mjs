import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
await page.evaluate(()=>{ try{localStorage.removeItem('fv_layouts_named'); localStorage.removeItem('fv_layout');}catch(e){} });
// build a 4-grid then save it via API (prompt blocked headless → stub)
await page.evaluate(()=>{ buildGrid('4'); });
await page.waitForTimeout(1500);
const saved = await page.evaluate(()=>{
  // stub prompt
  window.prompt=()=>"My Quad";
  saveNamedLayout();
  return { stored: localStorage.getItem('fv_layouts_named') };
});
// menu should now list "My Quad"
await page.locator('#layoutSelBtn').click(); await page.waitForTimeout(300);
const namedInMenu = await page.locator('#layoutMenu .tf-opt[data-named="My Quad"]').count();
// go single, then load named → back to 4
await page.evaluate(()=>buildGrid('1')); await page.waitForTimeout(500);
await page.evaluate(()=>loadNamedLayout('My Quad')); await page.waitForTimeout(1500);
const afterLoad = await page.evaluate(()=>({ layout:_gridLayout, gridOn:document.documentElement.classList.contains('grid-on'), iframes:document.querySelectorAll('#chartGrid iframe').length }));
console.log(JSON.stringify({saved, namedInMenu, afterLoad, appErrors:errs.slice(0,4)},null,2));
await browser.close();
