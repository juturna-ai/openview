import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const paints=[];
p.on('console',m=>{if(/SPAINT/.test(m.text()))console.log(m.text());});
p.on('pageerror',e=>{if(!/Value is null/.test(e.message))console.log('PAGEERR:',e.message);});
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(4000);
// Load a spread symbol, then time TF switches on it.
await p.evaluate(()=>{
  const rd=window.renderData;
  window.renderData=function(d,kv){
    console.log('SPAINT render len='+(d?d.length:0)+' kv='+kv+' @'+Math.round(performance.now()-(window.__t0||0))+'ms');
    return rd.apply(this,arguments);
  };
});
await p.evaluate(()=>{window.__t0=performance.now();console.log('SPAINT --- load NEAR-USD/INJ-USD @12h ---');loadChart('NEAR-USD/INJ-USD','12h');});
await p.waitForTimeout(8000);
await p.evaluate(()=>{window.__t0=performance.now();console.log('SPAINT --- switch to 4h ---');selectTF('4h');});
await p.waitForTimeout(8000);
await b.close(); process.exit(0);
