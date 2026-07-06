import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{if(!/Value is null/.test(e.message)){console.log('PAGEERR:',e.message);fail=true;}});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(3000);

// 1) RSI pane menu has a Settings item.
const rsi=await p.$('#rsi'); const box=await rsi.boundingBox();
await p.mouse.click(box.x+box.width/2, box.y+box.height/2, {button:'right'});
await p.waitForTimeout(300);
const menu=await p.evaluate(()=>{const m=document.getElementById('ctxMenu');return {vis:getComputedStyle(m).display!=='none', text:m.innerText.replace(/\n/g,' | ')};});
const hasSettings=/Settings/.test(menu.text);
console.log('RSI menu:', hasSettings?'PASS':'FAIL','—',menu.text);
if(!hasSettings) fail=true;

// 2) Click Settings → dialog opens with RSI Length field.
await p.evaluate(()=>{[...document.querySelectorAll('#ctxMenu .mi')].find(d=>/Settings/.test(d.innerText)).click();});
await p.waitForTimeout(300);
const dlgOpen=await p.evaluate(()=>({open:document.getElementById('settingsDlg')?.classList.contains('open'), hasLen:!!document.getElementById('rsi_len'), curLen:document.getElementById('rsi_len')?.value}));
console.log('RSI dialog:', (dlgOpen.hasLen)?'PASS':'FAIL','—',JSON.stringify(dlgOpen));
if(!dlgOpen.hasLen) fail=true;

// 3) Change length to 7, OK, and confirm RSI recomputed (value differs from len-14 baseline).
const before=await p.evaluate(()=>{const r=rsiSeries(lastData,14); return r.length?+r[r.length-1].value.toFixed(4):null;});
await p.evaluate(()=>{const el=document.getElementById('rsi_len'); el.value='7'; el.dispatchEvent(new Event('input',{bubbles:true}));});
await p.waitForTimeout(200);
await p.evaluate(()=>document.getElementById('dlgOk').click());
await p.waitForTimeout(400);
const after=await p.evaluate(()=>({param:RSI_PARAMS.len, label:document.getElementById('rsiName').innerText, persisted:localStorage.getItem('fv_rsi_params')}));
const applied = after.param===7 && /RSI 7/.test(after.label) && /"len":7/.test(after.persisted||'');
console.log('Applied len=7:', applied?'PASS':'FAIL','—',JSON.stringify(after));
if(!applied) fail=true;

console.log(fail?'FAIL ✗':'clean ✓');
await b.close(); process.exit(fail?1:0);
