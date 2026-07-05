import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);
await page.evaluate(()=>{ Object.keys(localStorage).filter(k=>k.startsWith('fv_indicators_')).forEach(k=>localStorage.removeItem(k)); });

// in catalog?
const inCatalog = await page.evaluate(()=>IND_CATALOG.some(c=>c.type==='volprofile'));
// add it
const added = await page.evaluate(()=>{ try{ const i=addIndicator('volprofile'); return {ok:!!i, flag:window.volProfileOn}; }catch(e){ return {ok:false, why:e.message}; } });
await page.waitForTimeout(600);
// count non-transparent pixels on the left edge of the draw canvas (the histogram)
const drewPixels = await page.evaluate(()=>{
  const c=document.getElementById('draw'); const ctx=c.getContext('2d');
  try{ const img=ctx.getImageData(0,0,Math.min(200,c.width),c.height).data; let n=0; for(let i=3;i<img.length;i+=4){ if(img[i]>0)n++; } return n; }
  catch(e){ return 'readback-blocked'; }
});
await page.screenshot({path:'volprofile.png'});
// remove it
const removed = await page.evaluate(()=>{ const ind=indicators.find(i=>i.type==='volprofile'); if(ind) removeIndicator(ind.id); return window.volProfileOn; });

console.log(JSON.stringify({inCatalog, added, drewPixels: typeof drewPixels==='number'?(drewPixels>500):drewPixels, flagAfterRemove:removed, appErrors:errs.slice(0,6)},null,2));
await browser.close();
