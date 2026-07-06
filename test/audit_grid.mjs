import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource|Value is null/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push('PAGEERR: '+e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
await page.evaluate(()=>{ try{ localStorage.removeItem('fv_layout'); }catch(e){} });

const btn = await page.locator('#layoutSelBtn').count();
// switch to 4-grid
await page.evaluate(()=>buildGrid('4'));
await page.waitForTimeout(1000);
const gridOn = await page.evaluate(()=>document.documentElement.classList.contains('grid-on'));
const iframes = await page.locator('#chartGrid iframe').count();
const layout = await page.evaluate(()=>document.getElementById('chartGrid').getAttribute('data-layout'));
// wait for iframes to load their apps, then check one has a chart
await page.waitForTimeout(6000);
const panelHasChart = await page.evaluate(()=>{
  const f=document.querySelector('#chartGrid iframe');
  try{ return !!(f.contentWindow && f.contentWindow.document.querySelector('canvas')); }catch(e){ return 'cross-origin? '+e.message; }
});
const panelSyms = await page.evaluate(()=>_gridPanels.map(p=>p.sym));
await page.screenshot({path:'grid4.png'});
// back to single
await page.evaluate(()=>buildGrid('1'));
await page.waitForTimeout(500);
const backToSingle = await page.evaluate(()=>!document.documentElement.classList.contains('grid-on'));
console.log(JSON.stringify({btn, gridOn, iframes, layout, panelHasChart, panelSyms, backToSingle, appErrors:errs.slice(0,6)},null,2));
await browser.close();
