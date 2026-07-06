import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>openMaSettings());
await p.waitForTimeout(400);
const r=await p.evaluate(()=>{
  const dlg=document.getElementById('settingsDlg');
  const db=dlg.querySelector('.db');
  const rows=dlg.querySelectorAll('.ma-editrow');
  const colorPickers=dlg.querySelectorAll('.ma_cl').length;
  // does any row overflow its container horizontally?
  let hOverflow=false;
  rows.forEach(row=>{ if(row.scrollWidth>row.clientWidth+1) hOverflow=true; });
  const dbHOverflow = db.scrollWidth>db.clientWidth+1;
  // is the whole card taller than viewport (would need scrolling to see footer)?
  const rect=dlg.getBoundingClientRect();
  const cardFitsViewport = rect.bottom<=window.innerHeight+1 && rect.top>=-1;
  // are all color pickers within the visible dialog width?
  let colorVisible=true;
  dlg.querySelectorAll('.ma_cl').forEach(el=>{ const rr=el.getBoundingClientRect(); const dr=dlg.getBoundingClientRect(); if(rr.right>dr.right+1||rr.left<dr.left-1) colorVisible=false; });
  return {maDlg:dlg.classList.contains('ma-dlg'), rows:rows.length, colorPickers, hOverflow, dbHOverflow, cardFitsViewport, colorVisible, width:rect.width};
});
console.log(JSON.stringify({...r, appErrors:errs.slice(0,4)},null,2));
await b.close();
