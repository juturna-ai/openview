import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ try{ localStorage.removeItem('fv_ind_templates'); Object.keys(localStorage).filter(k=>k.startsWith('fv_indicators_')).forEach(k=>localStorage.removeItem(k)); }catch(e){} });
const res=await p.evaluate(()=>{
  addIndicator('rsi'); addIndicator('macd'); addIndicator('bb');
  window.prompt=()=>"My Setup";
  saveIndTemplate();
  const tpl=JSON.parse(localStorage.getItem('fv_ind_templates')||'{}');
  // clear all, then load template
  [...indicators].forEach(i=>removeIndicator(i.id,true)); indicators.length=0;
  const afterClear=indicators.length;
  loadIndTemplate('My Setup');
  return { tplNames:Object.keys(tpl), tplLen:(tpl['My Setup']||[]).length, afterClear, afterLoad:indicators.length, types:indicators.map(i=>i.type) };
});
await p.waitForTimeout(800);
// dialog shows the template in the dropdown
await p.locator('#btnIndicators').click(); await p.waitForTimeout(400);
const tplInMenu=await p.locator('#indTpl option', {hasText:'My Setup'}).count();
console.log(JSON.stringify({res, tplInMenu, appErrors:errs.slice(0,4)}));
await b.close();
