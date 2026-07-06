import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource|Value is null/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push('PAGEERR: '+e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);

const btn = await page.locator('#btnReplay').count();
const fullLen = await page.evaluate(()=>lastData.length);
// enter replay
await page.locator('#btnReplay').click(); await page.waitForTimeout(300);
const picking = await page.evaluate(()=>_replay.picking);
// start at ~60% via API (click coords are fiddly)
await page.evaluate(()=>{ replayStartAt(Math.floor(_replay.full.length*0.6)); });
await page.waitForTimeout(600);
const afterStart = await page.evaluate(()=>({active:_replay.active, idx:_replay.idx, shown:lastData.length, full:_replay.full.length}));
const revealedLessThanFull = afterStart.shown < afterStart.full;
// step forward
await page.locator('#rbStep').click(); await page.waitForTimeout(300);
const afterStep = await page.evaluate(()=>({idx:_replay.idx, shown:lastData.length}));
const stepped = afterStep.idx===afterStart.idx+1 && afterStep.shown===afterStart.shown+1;
// play a moment
await page.locator('#rbPlay').click(); await page.waitForTimeout(1200);
const afterPlay = await page.evaluate(()=>_replay.idx);
const played = afterPlay > afterStep.idx;
await page.locator('#rbPlay').click(); // pause
// exit → all bars revealed
await page.locator('#rbExit').click(); await page.waitForTimeout(600);
const afterExit = await page.evaluate(()=>({active:_replay.active, shown:lastData.length}));
await page.screenshot({path:'replay.png'});
console.log(JSON.stringify({btn, fullLen, picking, afterStart, revealedLessThanFull, stepped, played, afterExit, exitRevealedAll: afterExit.shown>=fullLen*0.9, appErrors:errs.slice(0,5)},null,2));
await browser.close();
