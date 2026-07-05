import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

const legendPresent = await page.locator('#chartLegend').count();
const legendInChart = await page.evaluate(()=>{ const l=document.getElementById('chartLegend'); const w=document.getElementById('chartWrap'); return w&&l&&w.contains(l); });
const symRow = await page.locator('#legSymRow').innerText().catch(()=>'');
const ohlcInLegend = await page.evaluate(()=>{ const l=document.getElementById('chartLegend'); const o=document.getElementById('ohlc'); return l&&o&&l.contains(o); });
// topbar should NOT contain ohlc/maLegend anymore
const topbarHasOhlc = await page.evaluate(()=>{ const t=document.getElementById('topbar'); const o=document.getElementById('ohlc'); return t&&o&&t.contains(o); });
// add an MA + indicator to confirm they populate in the floating legend
await page.evaluate(()=>{ addIndicator('sma'); });
await page.waitForTimeout(800);
const maText = await page.locator('#maLegend').innerText().catch(()=>'');
const indRows = await page.locator('#indLegend .indrow').count();

await page.screenshot({path:'stepB_floatlegend.png'});
console.log(JSON.stringify({legendPresent, legendInChart, symRow, ohlcInLegend, topbarHasOhlc, maText:maText.slice(0,60), indRows, appErrors:errs.slice(0,6)},null,2));
await browser.close();
