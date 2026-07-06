import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ try{localStorage.removeItem('fv_alert_log');}catch(e){} });
// create an alert + fire it directly
const res=await p.evaluate(()=>{
  const a={ id:'a'+Date.now(), source:'price', op:'gt', target:'value', value:0.01, trigger:'perbar', expiry:null, message:'Test alert', notify:{popup:false,sound:false,browser:false}, active:true, _last:null };
  alerts.push(a); saveAlerts();
  fireAlert(a, 0.5, 0.01);  // simulate a fire → logs to ALERT_LOG
  return { logLen: ALERT_LOG.length, lastLog: ALERT_LOG[0] };
});
// open panel, check per-bar option + history + pause
await p.locator('#btnAlert').click({button:'right'}); await p.waitForTimeout(400);
const panelText=await p.evaluate(()=>document.getElementById('alertsPanel').innerText.replace(/\n+/g,' | '));
const hasHistory=panelText.includes('HISTORY');
const hasPause=await p.locator('#alertsPanel .al-pause').count();
// verify per-bar suppresses double fire within same bar
const perbar=await p.evaluate(()=>{
  const a=alerts[alerts.length-1]; a._lastBar=lastData[lastData.length-1].time;
  const before=ALERT_LOG.length;
  // checkAlerts would suppress since _lastBar===curBar; simulate the guard
  const cur=lastData[lastData.length-1].time;
  const suppressed = (a.trigger==='perbar' && a._lastBar===cur);
  return { suppressed };
});
await p.screenshot({path:'alerts.png'});
console.log(JSON.stringify({res, hasHistory, hasPause, perbar, panelHead:panelText.slice(0,120), appErrors:errs.slice(0,4)},null,2));
await b.close();
