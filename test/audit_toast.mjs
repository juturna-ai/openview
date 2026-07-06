import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
// settings gear button
const gearPresent=await p.locator('#btnSettings').count();
await p.locator('#btnSettings').click(); await p.waitForTimeout(300);
const settingsOpen=await p.evaluate(()=>document.getElementById('settingsDlg').classList.contains('open'));
await p.evaluate(()=>closeDlg());
// toast helper fires + renders
await p.evaluate(()=>toast("Test toast","ok"));
await p.waitForTimeout(200);
const toastVisible=await p.locator('#toastWrap .toast').count();
const toastText=await p.locator('#toastWrap .toast').first().innerText().catch(()=>'');
console.log(JSON.stringify({gearPresent, settingsOpen, toastVisible, toastText, appErrors:errs.slice(0,4)}));
await b.close();
