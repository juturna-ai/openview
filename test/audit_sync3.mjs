import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(5000);
await page.evaluate(()=>{ try{localStorage.removeItem('fv_layout');}catch(e){} buildGrid('2h'); });
await page.waitForTimeout(9000);
// Instrument: count postMessage crosshair events reaching the HOST (proves emit works),
// and that the host relays (proves relay works). Hook window.postMessage on host.
const counts = await page.evaluate(()=>{
  return new Promise(resolve=>{
    let hostRecv=0, relayed=0;
    const origAdd=window.addEventListener;
    window.addEventListener("message", ev=>{ if(ev.data&&ev.data.fvx==="crosshair") hostRecv++; });
    // wrap iframe postMessage to count relays out
    document.querySelectorAll('#chartGrid iframe').forEach(f=>{
      const w=f.contentWindow; const op=w.postMessage.bind(w);
      w.postMessage=(msg,o)=>{ if(msg&&msg.fvx==="crosshair") relayed++; return op(msg,o); };
    });
    // drive a mousemove over panel 0's canvas via the frame's own event
    const f0=document.querySelectorAll('#chartGrid iframe')[0];
    const doc0=f0.contentDocument, dc=doc0&&doc0.getElementById('draw');
    if(dc){ const r=dc.getBoundingClientRect();
      for(let i=0;i<5;i++){ const ev=new MouseEvent('mousemove',{clientX:r.left+r.width*0.3+i*10, clientY:r.top+r.height*0.5, bubbles:true}); dc.dispatchEvent(ev); }
    }
    setTimeout(()=>resolve({hostRecv, relayed, hadCanvas:!!dc}), 1500);
  });
});
console.log(JSON.stringify({counts, appErrors:errs.slice(0,4)},null,2));
await browser.close();
