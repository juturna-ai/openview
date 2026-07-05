import { chromium } from 'playwright';
const keys=['mcginley','kama','ckstop','lrc','tsi','kst','rvi','smi','woodies','crsi','eom','klinger','netvol','volosc','twap','bbpct','histvol','massidx','ulcer','bbp','ribbon','hl52'];
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);
// catalog presence
const inCatalog = await page.evaluate(ks=>ks.map(k=>({k, present: IND_CATALOG.some(c=>c.type===k)})), keys);
const missing = inCatalog.filter(x=>!x.present).map(x=>x.k);
// add each, check it created series with data
const results=[];
for(const k of keys){
  const r = await page.evaluate(key=>{
    try{
      const before=indicators.length;
      const ind=addIndicator(key);
      if(!ind) return {key, ok:false, why:'addIndicator returned null'};
      const hasSeries = ind.series && ind.series.length>0;
      removeIndicator(ind.id, true);
      return {key, ok:true, grew:indicators.length===before, hasSeries};
    }catch(e){ return {key, ok:false, why:e.message}; }
  }, k);
  results.push(r);
}
const failed=results.filter(r=>!r.ok);
// baseline: existing still work
const baseline=await page.evaluate(()=>{ try{ ['sma','rsi','macd'].forEach(t=>{const i=addIndicator(t); removeIndicator(i.id,true);}); return 'ok'; }catch(e){ return 'BROKE: '+e.message; } });
console.log(JSON.stringify({catalogMissing:missing, failedCount:failed.length, failed, baseline, appErrors:errs.slice(0,8)},null,2));
await browser.close();
