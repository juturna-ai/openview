// Feature test — §12: Pine Script v5 basic-subset parser (transpiles to the JS API).
// Covers: //@version=5 detection, indicator(overlay), input.*, ta.rsi/sma/ema/
// crossover, series arithmetic + comparison + ternary + history refs, plot with
// hex/named colors + linewidth, plotshape, hline, clear error for unsupported
// syntax (if/for), and plain-JS scripts unaffected.
//   Run:  node test/regression_pine_v5.mjs
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(process.env.FV_URL||"http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(8000);
const r=await p.evaluate(()=>{
  const pine=`//@version=5
indicator("My RSI", overlay=false)
len = input.int(14, "Length")
r = ta.rsi(close, len)
ma = ta.sma(r, 9)
plot(r, "RSI", color=#7E57C2, linewidth=2)
plot(ma, "MA", color=color.orange)
hline(70, "OB", color=color.gray)
hline(30, "OS", color=color.gray)`;
  const plots=runScript(pine, lastData);
  const pine2=`//@version=5
indicator("Cross", overlay=true)
fast = ta.ema(close, 12)
slow = ta.ema(close, 26)
up = ta.crossover(fast, slow)
plot(fast, color=color.green)
plot(slow, color=color.red)
plotshape(up, location=location.belowbar, color=color.green)`;
  const plots2=runScript(pine2, lastData);
  const pine3=`//@version=5
indicator("Math", overlay=true)
mid = (high + low) / 2
wide = close > open ? mid * 1.01 : mid[1]
plot(wide, color=color.blue)`;
  const plots3=runScript(pine3, lastData);
  const lastVals=a=>a.filter(x=>x!=null).slice(-3).map(x=>+x.toFixed(2));
  let err4=null; try{ runScript('//@version=5\nif close > open\n    x = 1', lastData); }catch(e){ err4=e.message; }
  return {
    p1:{n:plots.length, colors:plots.map(x=>x.color), panes:plots.map(x=>x.pane), rsiTail:lastVals(plots[0].arr)},
    p2:{n:plots2.length, kind:plots2[2].kind, markerCount:plots2[2].arr.filter(x=>x!=null).length},
    p3:{n:plots3.length, tail:lastVals(plots3[0].arr)},
    err4,
    jsStillWorks:(()=>{ const pl=runScript('plot(ta.ema(close,10),{pane:"main"});', lastData); return pl.length===1; })(),
  };
});
const ok = r.p1.n===4 && r.p1.colors[0]==="#7E57C2" && r.p1.panes[0]==="sub" && r.p1.rsiTail.every(v=>v>0&&v<100)
  && r.p2.n===3 && r.p2.kind==="markers" && r.p2.markerCount>0
  && r.p3.n===1 && r.p3.tail.every(v=>v>0)
  && /subset/.test(r.err4||"") && r.jsStillWorks && errs.length===0;
console.log(JSON.stringify(r));
console.log(ok?"PASS":"FAIL");
await b.close(); process.exit(ok?0:1);
