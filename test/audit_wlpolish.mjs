import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);   // let prices load for sort

const rowH = await page.evaluate(()=>{ const r=document.querySelector('.row'); return r?r.getBoundingClientRect().height:null; });
const headersClickable = await page.locator('#wlCols span[data-sort]').count();

// capture PRIVACY section order before + after sorting by Last
const orderBefore = await page.evaluate(()=>{
  // GROUPS order (source of truth) for PRIVACY
  const g=GROUPS.find(g=>g.name==='PRIVACY'); return g?g.symbols.slice():null;
});
// click "Last" header to sort
await page.locator('#wlCols span[data-sort="last"]').click();
await page.waitForTimeout(500);
const groupsUnchanged = await page.evaluate(sb=>{ const g=GROUPS.find(g=>g.name==='PRIVACY'); return JSON.stringify(g.symbols)===JSON.stringify(sb); }, orderBefore);
// DOM order of PRIVACY rows after sort (should differ from GROUPS if prices vary)
const domAfter = await page.evaluate(()=>{
  const rows=Array.from(document.querySelectorAll('#wlBody .row')); return rows.map(r=>r.dataset.sym).slice(0,20);
});
const sortedClass = await page.locator('#wlCols span.sorted').count();
await page.screenshot({path:'stepG_watchlist.png'});
console.log(JSON.stringify({rowH:Math.round(rowH), headersClickable, groupsUnchanged, sortedClass, domSample:domAfter.slice(0,8), appErrors:errs.slice(0,6)},null,2));
await browser.close();
