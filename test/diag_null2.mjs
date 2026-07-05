import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const bad=[];
page.on('console',m=>{ if(m.text().startsWith('BADSERIES')) bad.push(m.text()); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(1500);
// Wrap EXISTING known series (candle, maSeries[], rsiLine, rsiMa, aux[])
await page.evaluate(()=>{
  window.__scan=(label, arr)=>{
    if(!Array.isArray(arr)) return;
    let prev=-Infinity, issues=[];
    for(let i=0;i<arr.length;i++){ const e=arr[i];
      if(e && ('value' in e) && (e.value===null || Number.isNaN(e.value))) issues.push('nullval@'+i);
      if(e && ('open' in e) && (e.open===null||Number.isNaN(e.open)||e.close===null||Number.isNaN(e.close))) issues.push('nullohlc@'+i);
      if(e && typeof e.time==='number'){ if(e.time<=prev) issues.push('nonasc@'+i); prev=e.time; }
    }
    if(issues.length) console.log('BADSERIES '+label+' :: '+issues.slice(0,4).join(', ')+' (n='+arr.length+')');
  };
  const wrap=(s,label)=>{ if(!s||s.__w) return; s.__w=1; const os=s.setData.bind(s); s.setData=arr=>{ window.__scan(label,arr); return os(arr); }; };
  try{ wrap(candle,'candle'); }catch(e){}
  try{ maSeries.forEach((s,i)=>wrap(s,'ma'+i)); }catch(e){}
  try{ wrap(rsiLine,'rsiLine'); wrap(rsiMa,'rsiMa'); wrap(rsiOver,'rsiOver'); wrap(rsiUnder,'rsiUnder'); wrap(band70,'band70'); wrap(band30,'band30'); wrap(band50,'band50'); }catch(e){}
  try{ Object.entries(aux).forEach(([k,s])=>wrap(s,'aux:'+k)); }catch(e){}
});
// trigger reload → boot series setData now wrapped
await page.evaluate(()=>{ activeSymbol='BTC-USD'; activeTF='1h'; loadChart('BTC-USD','1h'); });
await page.waitForTimeout(6000);
console.log(JSON.stringify({badSeries: bad.slice(0,15)}, null, 2));
await browser.close();
