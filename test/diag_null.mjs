import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const bad=[];
page.on('console',m=>{ if(m.text().startsWith('BADSERIES')) bad.push(m.text()); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
// Patch addLineSeries BEFORE the app builds series? Too late (already loaded). Instead patch
// the prototype: wrap setData on every existing + future series by hooking chart.addLineSeries.
await page.evaluate(()=>{
  window.__scan=(label, arr)=>{
    if(!Array.isArray(arr)) return;
    let prev=-Infinity, issues=[];
    for(let i=0;i<arr.length;i++){ const e=arr[i];
      if(e && ('value' in e) && (e.value===null || Number.isNaN(e.value))) issues.push('nullval@'+i);
      if(e && typeof e.time==='number'){ if(e.time<=prev) issues.push('nonasc@'+i+'('+e.time+'<='+prev+')'); prev=e.time; }
    }
    if(issues.length) console.log('BADSERIES '+label+' :: '+issues.slice(0,5).join(', ')+' (n='+arr.length+')');
  };
  // wrap all series creators
  ['addLineSeries','addHistogramSeries','addAreaSeries','addBaselineSeries','addCandlestickSeries','addBarSeries'].forEach(fn=>{
    const proto=Object.getPrototypeOf(chart);
    if(!chart['__w_'+fn]){
      const orig=chart[fn].bind(chart);
      chart[fn]=(...a)=>{ const s=orig(...a); const os=s.setData.bind(s); s.setData=arr=>{ window.__scan(fn, arr); return os(arr); }; const ou=s.update.bind(s); s.update=x=>{ return ou(x); }; return s; };
      chart['__w_'+fn]=1;
    }
  });
});
await page.waitForTimeout(2000);
// trigger a reload that rebuilds series through the wrapped creators
await page.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await page.waitForTimeout(6000);
// add indicators through wrapped creators
await page.evaluate(()=>{ addIndicator('macd'); addIndicator('sma'); addIndicator('bb'); });
await page.waitForTimeout(3000);
console.log(JSON.stringify({badSeries: bad.slice(0,15)}, null, 2));
await browser.close();
