import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
await page.evaluate(()=>{ try{localStorage.removeItem('fv_layout');}catch(e){} buildGrid('2h'); });
await page.waitForTimeout(7000);  // let both panels load

// simulate a crosshair message from panel 0 → host should relay to panel 1
const relayed = await page.evaluate(()=>{
  return new Promise(resolve=>{
    const frames=document.querySelectorAll('#chartGrid iframe');
    if(frames.length<2){ resolve('only '+frames.length+' frames'); return; }
    let got=false;
    // patch panel 1's setCrosshairPosition to detect the relayed message
    try{
      const w1=frames[1].contentWindow;
      const orig=w1.chart.setCrosshairPosition.bind(w1.chart);
      w1.chart.setCrosshairPosition=(...a)=>{ got=true; return orig(...a); };
    }catch(e){ resolve('patch fail: '+e.message); return; }
    // emit a crosshair message as if from panel 0
    frames[0].contentWindow.parent.postMessage({fvx:'crosshair', time: Math.floor(Date.now()/1000)}, '*');
    // but that posts to top window (the host). Simulate more directly: dispatch from panel0's chart
    setTimeout(()=>resolve(got?'relayed-to-panel1':'not-relayed'), 800);
  });
});
// also verify the host listener + panels have the message handlers
const wiring = await page.evaluate(()=>{
  const f=document.querySelectorAll('#chartGrid iframe');
  return { panels:f.length, panel0Embed: f[0].contentWindow.IS_EMBED, syncFlag: _gridSyncCrosshair };
});
console.log(JSON.stringify({relayed, wiring, appErrors:errs.slice(0,5)},null,2));
await browser.close();
