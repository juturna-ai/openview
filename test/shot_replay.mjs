import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.locator('#btnReplay').click(); await p.waitForTimeout(200);
await p.evaluate(()=>{ replayStartAt(Math.floor(_replay.full.length*0.55)); });
await p.waitForTimeout(800);
await p.screenshot({path:'replay_active.png'});
await b.close(); console.log("shot");
