import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5500);
const vals=await p.evaluate(()=>{
  const keys=['price','rsi','macd','macdsig','atr','cci','vwap','willr','volume','ma25'];
  const out={}; keys.forEach(k=>{ const v=sourceValue(k); out[k]= (v==null?'null':(isFinite(v)?+v.toFixed(4):'NaN')); });
  return { out, sourceCount: ALERT_SOURCES.length };
});
console.log(JSON.stringify({vals, appErrors:errs.slice(0,4)},null,2));
await b.close();
