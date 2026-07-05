import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
const checks = await page.evaluate(()=>({
  title: document.title,
  canvases: document.querySelectorAll('canvas').length,
  catButtons: document.querySelectorAll('.tool.cat').length,
  floatingLegend: !!document.getElementById('chartLegend'),
  bottomBar: !!document.getElementById('bottomBar'),
  rangeShortcuts: document.querySelectorAll('#rangeShortcuts .rng').length,
  compareBtn: !!document.getElementById('btnCompare'),
  tfCount: (typeof TF!=='undefined')?Object.keys(TF).length:0,
  indCatalog: (typeof IND_CATALOG!=='undefined')?IND_CATALOG.length:0,
  chartOk: typeof chart!=='undefined',
  dataLoaded: (typeof lastData!=='undefined')?lastData.length:0,
}));
await page.screenshot({path:'restored.png'});
console.log(JSON.stringify({checks, appErrors:errs.slice(0,8)},null,2));
await browser.close();
