import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);
// right-click symbolBox
const sb=await page.locator('#symbolBox').boundingBox();
await page.mouse.click(sb.x+sb.width*0.5, sb.y+sb.height*0.5, {button:'right'});
await page.waitForTimeout(400);
const popVisible = await page.evaluate(()=>{ const p=document.getElementById('symInfoPop'); return p && p.style.display!=='none'; });
const rows = await page.locator('#symInfoPop .sirow').count();
const keys = await page.locator('#symInfoPop .sik').allInnerTexts();
const vals = await page.locator('#symInfoPop .siv').allInnerTexts();
await page.screenshot({path:'syminfo.png'});
console.log(JSON.stringify({popVisible, rows, keys, vals:vals.slice(0,6), appErrors:errs.slice(0,5)},null,2));
await browser.close();
