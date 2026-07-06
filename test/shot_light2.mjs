import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5500);
await p.evaluate(()=>applyTheme(true));
await p.waitForTimeout(3500);   // longer settle for RSI + rows repaint
const rsiBg=await p.evaluate(()=>{ try{ return rsiChart.options().layout.background.color; }catch(e){ return null; } });
await p.screenshot({path:'theme_light_final.png'});
console.log(JSON.stringify({rsiBg}));
await b.close();
