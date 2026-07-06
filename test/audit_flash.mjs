import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// countdown pill present at last price?
const countdownPresent=await p.evaluate(()=>{ const el=document.getElementById('barCountdown'); return el && el.style.display!=='none'; });
// simulate a tick that raises price → flash-up class applied
const flash=await p.evaluate(()=>{
  flashLastPrice(true);
  const el=document.getElementById('barCountdown');
  const hasUp=el.classList.contains('flash-up');
  flashLastPrice(false);
  const hasDown=el.classList.contains('flash-down');
  return { hasUp, hasDown };
});
console.log(JSON.stringify({countdownPresent, flash, appErrors:errs.slice(0,4)}));
await b.close();
