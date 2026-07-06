// Regression: right-clicking an indicator/RSI sub-pane must open the APP context
// menu (Settings / Add alert / Reset / Remove), not the browser's native menu.
// Bug: sub-panes are separate LWC charts with no overlay canvas, so the main
// chart's dcanvas contextmenu handler never fired there.
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{if(!/Value is null/.test(e.message)){console.log('PAGEERR:',e.message);fail=true;}});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(3000);

async function menuAt(sel){
  const el=await p.$(sel); const bb=await el.boundingBox();
  await p.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2, {button:'right'});
  await p.waitForTimeout(300);
  const r=await p.evaluate(()=>{
    const m=document.getElementById('ctxMenu');
    const vis=m && getComputedStyle(m).display!=='none';
    return { vis, text: vis ? m.innerText.replace(/\n/g,' | ') : null };
  });
  await p.mouse.click(5,5); await p.waitForTimeout(150);
  return r;
}

// RSI pane
const rsi=await menuAt('#rsi');
const rsiOk = rsi.vis && /Add alert on RSI/.test(rsi.text);
console.log('RSI pane:', rsiOk?'PASS':'FAIL', '—', rsi.text);
if(!rsiOk) fail=true;

// Add a sub-pane indicator, right-click it
await p.evaluate(()=>addIndicator('cci'));
await p.waitForTimeout(1500);
const ind=await menuAt('#subPanes .subpane');
const indOk = ind.vis && /Settings/.test(ind.text) && /Add alert on CCI/.test(ind.text) && /Remove indicator/.test(ind.text);
console.log('Indicator pane:', indOk?'PASS':'FAIL', '—', ind.text);
if(!indOk) fail=true;

// Alert item actually opens the dialog with the source preselected
await p.$eval('#rsi', el=>{ const bb=el.getBoundingClientRect(); const ev=new MouseEvent('contextmenu',{clientX:bb.x+bb.width/2,clientY:bb.y+bb.height/2,bubbles:true}); el.dispatchEvent(ev); });
await p.waitForTimeout(250);
await p.evaluate(()=>{ [...document.querySelectorAll('#ctxMenu .mi')].find(d=>/Add alert/.test(d.innerText)).click(); });
await p.waitForTimeout(350);
const dlg=await p.evaluate(()=>({open:document.getElementById('alertDlg').classList.contains('open'), src:(document.getElementById('ad_source')||{}).value}));
const dlgOk=dlg.open && dlg.src==='rsi';
console.log('Alert dialog:', dlgOk?'PASS':'FAIL', '—', JSON.stringify(dlg));
if(!dlgOk) fail=true;

console.log(fail?'REGRESSION ✗':'clean ✓');
await b.close(); process.exit(fail?1:0);
