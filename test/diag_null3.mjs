import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const logs=[];
page.on('console',m=>{ const t=m.text(); if(t.startsWith('EMPTYSERIES')||t.startsWith('WHITESPACE')) logs.push(t); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(1500);
// Wrap ALL series setData to flag arrays that contain ZERO real values (all whitespace) or are empty
await page.evaluate(()=>{
  const scan=(label,arr)=>{
    if(!Array.isArray(arr)) return;
    const real=arr.filter(e=>e && (('value' in e)|| ('open' in e)));
    if(arr.length>0 && real.length===0) console.log('WHITESPACE '+label+' all-whitespace n='+arr.length);
    if(arr.length===0) console.log('EMPTYSERIES '+label+' empty');
  };
  const wrap=(s,label)=>{ if(!s||s.__w) return; s.__w=1; const os=s.setData.bind(s); s.setData=arr=>{ scan(label,arr); return os(arr); }; };
  try{ wrap(candle,'candle'); maSeries.forEach((s,i)=>wrap(s,'ma'+i)); wrap(rsiLine,'rsiLine'); wrap(rsiMa,'rsiMa'); wrap(rsiOver,'rsiOver'); wrap(rsiUnder,'rsiUnder'); wrap(band70,'b70'); wrap(band30,'b30'); wrap(band50,'b50'); Object.entries(aux).forEach(([k,s])=>wrap(s,'aux:'+k)); }catch(e){}
  // wrap future creators too
  ['addLineSeries','addHistogramSeries','addAreaSeries','addBaselineSeries'].forEach(fn=>{
    const orig=chart[fn].bind(chart); chart[fn]=(...a)=>{ const s=orig(...a); wrap(s,fn); return s; };
  });
});
await page.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await page.waitForTimeout(6000);
console.log(JSON.stringify({logs: logs.slice(0,20)}, null, 2));
await browser.close();
