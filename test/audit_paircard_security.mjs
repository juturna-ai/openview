// Audit — pair info card: XSS-safe symbol handling + NaN-safe number rendering.
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1500,height:1050}});
const STEP=86400,BASE=1700000000,N=400;
function candles(){const r=[];for(let i=N-1;i>=0;i--){const t=BASE+i*STEP,o=100+Math.sin(i/12)*15;r.push([t,o-3,o+4,o,o+1.5,5000]);}return r;}
// Binance ticker MISSING openPrice → +undefined = NaN (the HIGH bug)
await ctx.route(/\/ticker\/24hr/, rt=>rt.fulfill({status:200,contentType:'application/json',body:JSON.stringify({lastPrice:"1.865",highPrice:"2.07",lowPrice:"1.86",volume:"1000",quoteVolume:"2000"})})); // no openPrice
await ctx.route(/klines/, rt=>rt.fulfill({status:200,contentType:'application/json',body:JSON.stringify(candles().map(c=>[c[0]*1000,String(c[3]),String(c[2]),String(c[1]),String(c[4]),String(c[5]),0,0,0,0,0,0]))}));
await ctx.route(/candles|exchangeInfo|\/products(\?|$)|tickers/, rt=>rt.fulfill({status:200,contentType:'application/json',body:'[]'}));
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:5599/index.html',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>typeof normSym==='function' && typeof openPairInfoCard==='function',{timeout:20000}).catch(()=>{});
await p.waitForTimeout(800);

// t1 — normSym strips markup chars
const t1 = await p.evaluate(()=>{ const s=normSym('<img src=x onerror=window.__xss=1>'); return s && !/[<>()"']/.test(s); });

// t2 — even a pre-existing hostile symbol injected straight into the watchlist can't fire
const t2 = await p.evaluate(async ()=>{
  window.__xss=0;
  GROUPS.length=0; GROUPS.push({name:'T',symbols:['<img src=x onerror=window.__xss=1>-USD']}); // bypass normSym, simulate old persisted
  saveGroups(); buildWatchlist();
  await new Promise(r=>setTimeout(r,300));
  return window.__xss===0;
});

// t3 — NaN-safe: Binance ticker has no openPrice; card must NOT show "NaN"
const t3 = await p.evaluate(async ()=>{
  GROUPS.length=0; GROUPS.push({name:'T',symbols:['BINANCE:NEARUSDT']}); saveGroups(); buildWatchlist();
  openPairInfoCard('BINANCE:NEARUSDT');
  await new Promise(r=>setTimeout(r,2500));
  const txt=document.getElementById('pairCard').textContent;
  return !txt.includes('NaN');
});

// t4 — fmtPrice guards
const t4 = await p.evaluate(()=> fmtPrice(NaN)==='—' && fmtPrice(undefined)==='—' && fmtPrice(Infinity)==='—' && fmtPrice(1234.5).includes('1,234'));

console.log(JSON.stringify({t1,t2,t3,t4,errs:errs.filter(e=>!/Value is null/.test(e)).slice(0,3)},null,2));
console.log((t1&&t2&&t3&&t4)?'PASS':'FAIL');
await b.close();
