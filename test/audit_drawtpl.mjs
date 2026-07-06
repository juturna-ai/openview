import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ try{localStorage.removeItem('fv_draw_default');}catch(e){} });
const res=await p.evaluate(()=>{
  const before=DEFAULT_STYLE.color;
  const s={ id:newId(), type:'trend', pts:[{time:lastData[10].time,price:0.3},{time:lastData[40].time,price:0.4}], style:{color:'#ff9800', width:4, dash:2, fill:'rgba(255,152,0,0.1)', showLabel:true} };
  saveDrawTemplate(s);
  return { before, afterColor:DEFAULT_STYLE.color, afterWidth:DEFAULT_STYLE.width, saved:localStorage.getItem('fv_draw_default') };
});
// reload → persists
await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(4500);
const afterReload=await p.evaluate(()=>({ color:DEFAULT_STYLE.color, width:DEFAULT_STYLE.width }));
console.log(JSON.stringify({res, afterReload, persists: afterReload.color==='#ff9800'&&afterReload.width===4, appErrors:errs.slice(0,4)}));
await b.close();
