import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
const res = await page.evaluate(()=>{
  const code = `
    const fast = ta.ema(close, 10);
    const slow = ta.ema(close, 30);
    plot(fast,{color:'#26a69a'}); plot(slow,{color:'#ef5350'});
    strategy.entry(ta.crossover(fast, slow));
    strategy.exit(ta.crossunder(fast, slow));
  `;
  try{
    addScript('EMA Strategy', code);
    const sc=scripts.find(s=>s.name==='EMA Strategy');
    return { added:true, error:sc.error, bt: sc.backtest ? {net:+sc.backtest.netPct.toFixed(2), win:+sc.backtest.winRate.toFixed(1), trades:sc.backtest.numTrades, equityPts:sc.backtest.equity.length} : null };
  }catch(e){ return {added:false, error:e.message}; }
});
await page.waitForTimeout(800);
const panelVisible = await page.evaluate(()=>{ const p=document.getElementById('strategyPanel'); return p && p.style.display!=='none'; });
const panelText = await page.evaluate(()=>{ const p=document.getElementById('strategyPanel'); return p? p.innerText.replace(/\n+/g,' | ') : ''; });
await page.screenshot({path:'strategy.png'});
console.log(JSON.stringify({res, panelVisible, panelText:panelText.slice(0,160), appErrors:errs.slice(0,5)},null,2));
await browser.close();
