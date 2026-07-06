import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>applyTheme(true));
await p.waitForTimeout(2500);
await p.screenshot({path:'theme_light_clean.png'});
await b.close(); console.log("shot taken");
