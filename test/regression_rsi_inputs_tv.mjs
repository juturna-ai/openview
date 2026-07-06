// Regression: RSI Inputs tab has full TradingView parity — Source, Calculate Divergence,
// Smoothing Type + Length + BB StdDev (enabled only for BB), Calculation section.
// And the fields actually drive the calc (source changes RSI values; type changes MA).
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{if(!/Value is null/.test(e.message)){console.log('PAGEERR:',e.message);fail=true;}});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(2500);

await p.evaluate(()=>openRsiSettings());
await p.waitForTimeout(300);
const fields=await p.evaluate(()=>({
  hasSrc:!!document.getElementById('rsi_src'),
  hasDiv:!!document.getElementById('rsi_div'),
  hasType:!!document.getElementById('rsi_matype'),
  types:[...document.querySelectorAll('#rsi_matype option')].map(o=>o.value),
  hasBB:!!document.getElementById('rsi_bbsd'),
  bbDisabledDefault:document.getElementById('rsi_bbsd').disabled, // SMA default → disabled
  hasTf:!!document.getElementById('rsi_tf'),
  hasWait:!!document.getElementById('rsi_wait'),
  sections:[...document.querySelectorAll('.dpane[data-p=inputs] .dsec')].map(s=>s.textContent),
}));
const parityOk = fields.hasSrc&&fields.hasDiv&&fields.hasType&&fields.hasBB&&fields.hasTf&&fields.hasWait
  && fields.types.includes('EMA') && fields.types.includes('Bollinger Bands')
  && fields.bbDisabledDefault===true
  && fields.sections.join().toLowerCase().includes('smoothing');
console.log('Inputs parity:', parityOk?'PASS':'FAIL', JSON.stringify(fields));
if(!parityOk) fail=true;

// Source drives calc: RSI(close) vs RSI(high) differ
const srcEffect=await p.evaluate(()=>{
  const c=rsiSeries(lastData,14,'close'), h=rsiSeries(lastData,14,'high');
  return { close:+c[c.length-1].value.toFixed(4), high:+h[h.length-1].value.toFixed(4) };
});
console.log('Source affects RSI:', (srcEffect.close!==srcEffect.high)?'PASS':'FAIL', JSON.stringify(srcEffect));
if(srcEffect.close===srcEffect.high) fail=true;

// MA type drives smoothing: SMA vs EMA differ
const typeEffect=await p.evaluate(()=>{
  const r=rsiSeries(lastData,14,'close');
  const sma=rsiSmoothMA(r,14,'SMA'), ema=rsiSmoothMA(r,14,'EMA');
  return { sma:+sma[sma.length-1].value.toFixed(4), ema:+ema[ema.length-1].value.toFixed(4) };
});
console.log('MA type affects smoothing:', (typeEffect.sma!==typeEffect.ema)?'PASS':'FAIL', JSON.stringify(typeEffect));
if(typeEffect.sma===typeEffect.ema) fail=true;

// BB StdDev enables when Type=Bollinger Bands
await p.evaluate(()=>{ const t=document.getElementById('rsi_matype'); t.value='Bollinger Bands'; t.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(150);
const bbEnabled=await p.evaluate(()=>!document.getElementById('rsi_bbsd').disabled);
console.log('BB StdDev enables for BB type:', bbEnabled?'PASS':'FAIL');
if(!bbEnabled) fail=true;

// Divergence toggle → markers set (non-empty) when enabled
await p.evaluate(()=>{ RSI_PARAMS.divergence=true; renderData(lastData,true); });
await p.waitForTimeout(150);
const markers=await p.evaluate(()=>{ try{ return rsiDivergenceMarkers(lastData, rsiSeries(lastData,RSI_PARAMS.len,RSI_PARAMS.src)).length; }catch(e){ return -1; } });
console.log('Divergence markers computed:', markers>0?'PASS':'WARN(0 found, data-dependent)', '('+markers+')');
// don't fail on 0 (data-dependent), only on error
if(markers<0) fail=true;

// persist src/type
await p.evaluate(()=>openRsiSettings()); await p.waitForTimeout(150);
await p.evaluate(()=>{ const s=document.getElementById('rsi_src'); s.value='high'; s.dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('dlgOk').click(); });
await p.waitForTimeout(200);
const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('fv_rsi_params')));
console.log('Persist src/type:', (saved.src==='high'&&saved.maType)?'PASS':'FAIL', JSON.stringify({src:saved.src,maType:saved.maType}));
if(saved.src!=='high') fail=true;

console.log(fail?'FAIL ✗':'clean ✓');
await b.close(); process.exit(fail?1:0);
