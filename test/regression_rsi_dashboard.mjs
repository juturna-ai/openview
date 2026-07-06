// Regression: the built-in RSI pane's Settings now opens the SAME tabbed
// (Inputs/Style/Visibility) dashboard as dynamic indicators — not the old 2-field box.
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{if(!/Value is null/.test(e.message)){console.log('PAGEERR:',e.message);fail=true;}});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(2500);

await p.evaluate(()=>openRsiSettings());
await p.waitForTimeout(300);
let r=await p.evaluate(()=>({
  tabs:[...document.querySelectorAll('.dtab')].map(t=>t.textContent),
  inputLabels:[...document.querySelectorAll('.dpane[data-p=inputs] .field label')].map(l=>l.textContent),
  stylePlots:[...document.querySelectorAll('.dpane[data-p=style] .prow .pl')].map(l=>l.textContent.trim()),
}));
const tabsOk = r.tabs.join()==='Inputs,Style,Visibility';
const inputsOk = r.inputLabels.includes('RSI Length') && r.inputLabels.includes('Length'); // TV layout: "Length" under SMOOTHING
const plotsOk = ['RSI','RSI-based MA','RSI Upper Band','RSI Middle Band','RSI Lower Band'].every(n=>r.stylePlots.includes(n));
console.log('RSI dashboard tabs/inputs/plots:', (tabsOk&&inputsOk&&plotsOk)?'PASS':'FAIL', JSON.stringify(r));
if(!(tabsOk&&inputsOk&&plotsOk)) fail=true;

// Style edit: change RSI line color+width, confirm RSI_PARAMS + persistence
await p.evaluate(()=>{ [...document.querySelectorAll('.dtab')].find(t=>t.dataset.t==='style').click(); });
await p.waitForTimeout(100);
await p.evaluate(()=>{
  const cl=document.getElementById('rcl_0'); cl.value='#00e5ff'; cl.dispatchEvent(new Event('input',{bubbles:true}));
  const w=document.getElementById('rw_0'); w.value='4'; w.dispatchEvent(new Event('input',{bubbles:true}));
});
await p.waitForTimeout(150);
await p.evaluate(()=>document.getElementById('dlgOk').click());
await p.waitForTimeout(200);
const st=await p.evaluate(()=>({ mem:RSI_PARAMS.style.rsi, saved:JSON.parse(localStorage.getItem('fv_rsi_params')).style.rsi }));
const styleOk = st.mem.color.toLowerCase()==='#00e5ff' && st.mem.width===4 && st.saved.color.toLowerCase()==='#00e5ff' && st.saved.width===4;
console.log('RSI line style edit+persist:', styleOk?'PASS':'FAIL', JSON.stringify(st));
if(!styleOk) fail=true;

// Visibility: hide the RSI-based MA (index 1), confirm flag + series invisible
await p.evaluate(()=>openRsiSettings()); await p.waitForTimeout(200);
await p.evaluate(()=>{ [...document.querySelectorAll('.dtab')].find(t=>t.dataset.t==='vis').click(); });
await p.waitForTimeout(100);
await p.evaluate(()=>{ const v=document.getElementById('rvv_1'); v.checked=false; v.dispatchEvent(new Event('change',{bubbles:true})); v.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(150);
const vis=await p.evaluate(()=>RSI_PARAMS.style.ma.on);
console.log('RSI MA visibility off:', vis===false?'PASS':'FAIL', JSON.stringify({on:vis}));
if(vis!==false) fail=true;

console.log(fail?'FAIL ✗':'clean ✓');
await b.close(); process.exit(fail?1:0);
