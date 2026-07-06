// Regression: TradingView-style indicator settings dashboard.
// - Inputs tab shows readable labels (not raw keys)
// - Style tab: per-plot color + width + line-style; changes apply to the series + persist
// - Visibility tab: per-plot show/hide toggles the series
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{if(!/Value is null/.test(e.message)){console.log('PAGEERR:',e.message);fail=true;}});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(2500);

async function open(type){
  await p.evaluate(t=>{ const ind=addIndicator(t); window.__ind=ind.id; openIndicatorSettings(ind.id); }, type);
  await p.waitForTimeout(300);
}
async function closeDlgOk(){ await p.evaluate(()=>document.getElementById('dlgOk').click()); await p.waitForTimeout(200); }

// 1) MACD — Inputs labels + 3 named plots
await open('macd');
let r=await p.evaluate(()=>({
  tabs:[...document.querySelectorAll('.dtab')].map(t=>t.textContent),
  inputLabels:[...document.querySelectorAll('.dpane[data-p=inputs] .field label')].map(l=>l.textContent),
  stylePlots:[...document.querySelectorAll('.dpane[data-p=style] .prow .pl')].map(l=>l.textContent.trim()),
}));
const macdOk = r.tabs.join()==='Inputs,Style,Visibility'
  && r.inputLabels.includes('Fast Length') && r.inputLabels.includes('Signal Smoothing')
  && r.stylePlots.includes('MACD') && r.stylePlots.includes('Signal') && r.stylePlots.includes('Histogram');
console.log('MACD dialog:', macdOk?'PASS':'FAIL', JSON.stringify(r));
if(!macdOk) fail=true;
await closeDlgOk();

// 2) BB — change plot 1 (Upper) color+width via Style, confirm series updates + persists
await open('bb');
await p.evaluate(()=>{
  // switch to style tab
  [...document.querySelectorAll('.dtab')].find(t=>t.dataset.t==='style').click();
});
await p.waitForTimeout(100);
await p.evaluate(()=>{
  const cl=document.getElementById('pcl_1'); cl.value='#ff00ff'; cl.dispatchEvent(new Event('input',{bubbles:true}));
  const pw=document.getElementById('pw_1'); pw.value='4'; pw.dispatchEvent(new Event('input',{bubbles:true}));
});
await p.waitForTimeout(150);
const bbState=await p.evaluate(()=>{ const ind=indicators.find(i=>i.id===window.__ind); return {c:ind.plotStyle[1].color, w:ind.plotStyle[1].width}; });
console.log('BB Upper style edit:', (bbState.c.toLowerCase()==='#ff00ff'&&bbState.w===4)?'PASS':'FAIL', JSON.stringify(bbState));
if(!(bbState.c.toLowerCase()==='#ff00ff'&&bbState.w===4)) fail=true;
await closeDlgOk();
// persistence
const persisted=await p.evaluate(()=>{ const raw=JSON.parse(localStorage.getItem('fv_indicators_'+activeSymbol)); const bb=raw.find(x=>x.type==='bb'); return bb&&bb.plotStyle&&bb.plotStyle[1]; });
console.log('BB persisted:', (persisted&&persisted.color.toLowerCase()==='#ff00ff'&&persisted.width===4)?'PASS':'FAIL', JSON.stringify(persisted));
if(!(persisted&&persisted.color.toLowerCase()==='#ff00ff'&&persisted.width===4)) fail=true;

// 3) Visibility — hide plot 0 of BB, confirm series set invisible
await p.evaluate(()=>openIndicatorSettings(window.__ind)); await p.waitForTimeout(200);
await p.evaluate(()=>{ [...document.querySelectorAll('.dtab')].find(t=>t.dataset.t==='vis').click(); });
await p.waitForTimeout(100);
await p.evaluate(()=>{ const v=document.getElementById('vv_0'); v.checked=false; v.dispatchEvent(new Event('change',{bubbles:true})); v.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(150);
const hid=await p.evaluate(()=>{ const ind=indicators.find(i=>i.id===window.__ind); return ind.plotHidden[0]; });
console.log('BB Basis hidden flag:', hid===true?'PASS':'FAIL', JSON.stringify({hid}));
if(hid!==true) fail=true;
await closeDlgOk();

console.log(fail?'FAIL ✗':'clean ✓');
await b.close(); process.exit(fail?1:0);
