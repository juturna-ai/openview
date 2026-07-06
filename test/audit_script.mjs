import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
// add a script exercising ta + plot + plotshape + hline
const res = await page.evaluate(()=>{
  const code = `
    const fast = ta.ema(close, 9);
    const slow = ta.ema(close, 21);
    plot(fast, {color:'#26a69a', title:'EMA9'});
    plot(slow, {color:'#ef5350', title:'EMA21'});
    const buy = ta.crossover(fast, slow);
    plotshape(buy, {location:'below', color:'#26a69a', title:'BUY'});
    hline(0.4, {color:'#888'});
    const r = ta.rsi(14);
    plotHist(r.map(x=>x!=null?x-50:null), {pane:'sub', title:'RSI-50'});
  `;
  try{
    addScript('Test EMA cross', code);
    const sc = scripts[scripts.length-1];
    return { added:true, error:sc.error, seriesCount:sc.series.length, hasSubPane:!!sc.subChart };
  }catch(e){ return { added:false, error:e.message }; }
});
await page.waitForTimeout(1000);
await page.screenshot({path:'script.png'});
console.log(JSON.stringify({res, appErrors:errs.slice(0,5)},null,2));
await browser.close();
