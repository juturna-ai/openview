import { chromium } from 'playwright';
const URL='http://127.0.0.1:5501/';
const types=['hlcbars','linemark','step','columns','highlow','renko','kagi','pnf','linebreak'];
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
const results={};
for(const t of types){
  errs.length=0;
  // call setChartType directly (menu wiring already covered by CHART_TYPES render)
  const ok=await page.evaluate(t=>{ try{ setChartType(t); return true; }catch(e){ return 'THREW: '+e.message; } }, t);
  await page.waitForTimeout(1200);
  // read how many data points the active aux series got, via a probe
  const probe=await page.evaluate(t=>{
    try{
      const s=(window.aux&&window.aux[t])||null;
      // lightweight-charts has no public getData; instead check the series exists + chart has bars
      return { auxExists: !!s, chartType: window.chartType };
    }catch(e){ return {err:e.message}; }
  }, t);
  await page.screenshot({path:`ct_${t}.png`});
  results[t]={setChartType:ok, probe, consoleErrors: errs.filter(e=>!/HTTP|404|429|Failed to load resource/.test(e)).slice(0,5)};
}
// menu presence check
const menu=await page.evaluate(()=>Array.from(document.querySelectorAll('#ctMenu .tf-opt')).map(o=>o.dataset.ct));
console.log(JSON.stringify({menuKeys:menu, results},null,2));
await browser.close();
