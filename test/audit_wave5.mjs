import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

// sanity: existing indicators still add cleanly before we touch anything new
const baseline=['sma','rsi','macd'];
const baselineResults=[];
for(const key of baseline){
  const before=await page.evaluate(()=>indicators.length);
  const r=await page.evaluate((k)=>{
    try{ const ind=addIndicator(k); return {ok:true, hasInd:!!ind, series:ind?ind.series.length:0}; }
    catch(e){ return {ok:false, err:String(e)}; }
  }, key);
  const after=await page.evaluate(()=>indicators.length);
  baselineResults.push({key, grew: after>before, ...r});
}

const NEW_KEYS = [
  'mcginley','kama','ckstop','lrc',
  'tsi','kst','rvi','smi','woodies','crsi',
  'eom','klinger','netvol','volosc','twap',
  'bbpct','histvol','massidx','ulcer',
  'bbp','ribbon','hl52'
];

const results=[];
for(const key of NEW_KEYS){
  errs.length=0; // reset — attribute errors to this indicator only
  const before=await page.evaluate(()=>indicators.length);
  const addRes=await page.evaluate((k)=>{
    try{
      const ind=addIndicator(k);
      if(!ind) return {ok:false, err:'addIndicator returned falsy (missing from IND_CATALOG?)'};
      return {ok:true, id:ind.id, seriesCount:ind.series.length, pane:ind.pane};
    }catch(e){ return {ok:false, err:String(e&&e.stack||e)}; }
  }, key);
  await page.waitForTimeout(200);
  const after=await page.evaluate(()=>indicators.length);
  // check series actually received non-empty data by inspecting internal data via a marker:
  // lightweight-charts doesn't expose getData(), so we check no throw + series count + array grew.
  let dataCheck=null;
  if(addRes.ok){
    dataCheck=await page.evaluate((id)=>{
      const ind=indicators.find(i=>i.id===id); if(!ind) return {found:false};
      return {found:true, seriesCount:ind.series.length};
    }, addRes.id);
    // remove it so subsequent indicators aren't crowding panes / legend
    await page.evaluate((id)=>{ try{ removeIndicator(id, true); }catch(e){} }, addRes.id);
  }
  results.push({
    key,
    grew: after>before,
    addRes,
    dataCheck,
    newErrors: [...errs]
  });
  await page.waitForTimeout(150);
}

// re-add a handful together (not removed) to take a visual screenshot
for(const key of ['mcginley','kama','ribbon','hl52','lrc']){
  await page.evaluate((k)=>{ try{ addIndicator(k); }catch(e){} }, key);
  await page.waitForTimeout(150);
}
await page.screenshot({path:'wave5_main_overlays.png'});

// clear those, then add sub-pane oscillators/volume/volatility for a screenshot
await page.evaluate(()=>{ [...indicators].forEach(i=>removeIndicator(i.id,true)); });
await page.waitForTimeout(200);
for(const key of ['tsi','kst','rvi','smi','woodies','crsi']){
  await page.evaluate((k)=>{ try{ addIndicator(k); }catch(e){} }, key);
  await page.waitForTimeout(150);
}
await page.screenshot({path:'wave5_momentum_subpanes.png'});

await page.evaluate(()=>{ [...indicators].forEach(i=>removeIndicator(i.id,true)); });
await page.waitForTimeout(200);
for(const key of ['eom','klinger','netvol','volosc','bbpct','histvol','massidx','ulcer']){
  await page.evaluate((k)=>{ try{ addIndicator(k); }catch(e){} }, key);
  await page.waitForTimeout(150);
}
await page.screenshot({path:'wave5_volume_volatility_subpanes.png'});

await page.evaluate(()=>{ [...indicators].forEach(i=>removeIndicator(i.id,true)); });
await page.waitForTimeout(200);
for(const key of ['bbp','twap']){
  await page.evaluate((k)=>{ try{ addIndicator(k); }catch(e){} }, key);
  await page.waitForTimeout(150);
}
await page.screenshot({path:'wave5_other.png'});

console.log('=== BASELINE (existing indicators must still work) ===');
console.log(JSON.stringify(baselineResults,null,2));
console.log('=== WAVE 5 NEW INDICATORS ===');
console.log(JSON.stringify(results,null,2));

const failures = results.filter(r=>!r.addRes.ok || !r.grew || r.newErrors.length>0);
console.log('=== SUMMARY ===');
console.log('Total new keys tested:', NEW_KEYS.length);
console.log('Clean (no error, grew, no console errors):', NEW_KEYS.length-failures.length);
console.log('Failures:', failures.map(f=>f.key));

await browser.close();
