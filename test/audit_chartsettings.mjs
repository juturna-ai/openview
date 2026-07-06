import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ try{localStorage.removeItem('fv_chart_settings');}catch(e){} });
// open settings via API
await p.evaluate(()=>openChartSettings());
await p.waitForTimeout(400);
const dlgOpen=await p.evaluate(()=>document.getElementById('settingsDlg').classList.contains('open'));
const fields=await p.locator('#settingsDlg input').count();
// change up color to orange
await p.evaluate(()=>{ const el=document.getElementById('cs_up'); el.value='#ff9800'; el.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(400);
const applied=await p.evaluate(()=>{ try{ return candle.options().upColor; }catch(e){ return null; } });
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('fv_chart_settings')||'{}').up);
await p.evaluate(()=>closeDlg());
// reload → persists
await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(4500);
const afterReload=await p.evaluate(()=>{ try{ return candle.options().upColor; }catch(e){ return null; } });
console.log(JSON.stringify({dlgOpen, fields, applied, saved, afterReload, persists: afterReload==='#ff9800', appErrors:errs.slice(0,4)}));
await b.close();
