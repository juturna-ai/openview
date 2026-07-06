import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
const railBtns=await p.locator('#rightRail .rr-btn').count();
// open news stub
await p.locator('#rightRail .rr-btn[title="News"]').click(); await p.waitForTimeout(300);
const newsVisible=await p.evaluate(()=>{ const s=document.getElementById('stubPanel'); return s&&s.style.display==='block'&&s.innerText.includes('News'); });
// open screener
await p.locator('#rightRail .rr-btn[title="Screener"]').click(); await p.waitForTimeout(300);
const screenerVisible=await p.evaluate(()=>document.getElementById('stubPanel').innerText.includes('Screener'));
// paper
await p.locator('#rightRail .rr-btn[title="Paper trading"]').click(); await p.waitForTimeout(300);
const paperVisible=await p.evaluate(()=>document.getElementById('stubPanel').innerText.includes('Paper'));
await p.screenshot({path:'stubs.png'});
console.log(JSON.stringify({railBtns, newsVisible, screenerVisible, paperVisible, appErrors:errs.slice(0,4)}));
await b.close();
