// Verifies the 3 fixes: (1) watchlist list-menu (10 items), (2) head&shoulders
// tool draws a 7-point labeled path, (3) alert webhook POSTs on trigger.
import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
let fail=false;
p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)){ console.log('PAGEERR:',e.message); fail=true; } });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:30000});
await p.waitForFunction(()=>typeof lastData!=='undefined'&&lastData.length>0,{timeout:30000});
await p.waitForTimeout(2500);

// ── (1) Watchlist list menu ──
await p.click("#wlNameBtn");
await p.waitForTimeout(200);
const menuText = await p.evaluate(()=>{
  const m=document.getElementById("wlNameMenu");
  return (m && getComputedStyle(m).display!=="none") ? m.innerText : null;
});
const need=["Share list","Add alert on the list","Make a copy","Rename","Add section","Clear list","Create new list","Upload list","Open list"];
const missing=need.filter(t=>!menuText || !menuText.includes(t));
console.log("MENU items present:", missing.length===0, missing.length?("MISSING: "+missing.join(", ")):"");
await p.evaluate(()=>document.getElementById("wlNameMenu").style.display="none");

// create a second list then switch back, to populate RECENTLY USED
await p.evaluate(()=>{ WATCHLISTS["TESTLIST"]=[{name:"S1",symbols:["BTC-USD"]}]; switchWatchlist("TESTLIST"); });
await p.waitForTimeout(200);
await p.evaluate(()=>{ const first=Object.keys(WATCHLISTS).find(n=>n!=="TESTLIST"); switchWatchlist(first); });
await p.waitForTimeout(200);
await p.click("#wlNameBtn"); await p.waitForTimeout(200);
const hasRecent = await p.evaluate(()=>{
  const m=document.getElementById("wlNameMenu");
  return m.innerText.includes("RECENTLY USED") && m.innerText.includes("TESTLIST");
});
console.log("RECENTLY USED shows TESTLIST:", hasRecent);
// click-to-switch from recent
const switched = await p.evaluate(()=>{
  const it=[...document.querySelectorAll("#wlNameMenu .mi")].find(x=>x.dataset.wl==="TESTLIST");
  if(!it) return false; it.click(); return ACTIVE_WL==="TESTLIST";
});
console.log("Click recent switches list:", switched);

// Shift+W opens list browser
await p.keyboard.press("Shift+W"); await p.waitForTimeout(200);
const browserOpen = await p.evaluate(()=>!!document.getElementById("wlBrowser"));
console.log("Shift+W opens list browser:", browserOpen);
await p.evaluate(()=>{ const d=document.getElementById("wlBrowser"); if(d) d.querySelector("#wlbClose").click(); });

// ── (2) Head & Shoulders tool ──
const hsResult = await p.evaluate(async ()=>{
  const before = draw.shapes.length;
  selectTool("headshoulders");
  const cv=document.getElementById("draw"); const r=cv.getBoundingClientRect();
  // 7 clicks forming LS/T1/H/T2/RS + 2 neckline pts
  const pts=[[.30,.55],[.37,.68],[.45,.35],[.53,.68],[.60,.55],[.34,.66],[.63,.66]];
  for(const [fx,fy] of pts){
    const ev=t=>new MouseEvent(t,{clientX:r.left+r.width*fx,clientY:r.top+r.height*fy,bubbles:true});
    cv.dispatchEvent(ev("mousedown")); cv.dispatchEvent(ev("mouseup")); cv.dispatchEvent(ev("click"));
    await new Promise(res=>setTimeout(res,40));
  }
  const s=draw.shapes[draw.shapes.length-1];
  return { added: draw.shapes.length-before, type: s&&s.type, npts: s&&s.pts&&s.pts.length };
});
console.log("Head&Shoulders drawn:", hsResult.added===1 && hsResult.type==="headshoulders" && hsResult.npts===7, JSON.stringify(hsResult));

// ── (3) Alert webhook POST ──
let webhookHit=null;
await p.route("**/hooktest", route=>{ webhookHit=route.request().postData(); route.fulfill({status:200,body:"ok"}); });
const fired = await p.evaluate(()=>{
  const a={ id:"wtest", source:"price", op:"gt", target:"value", value:0,
            trigger:"every", message:"WH test", notify:{popup:false,sound:false,browser:false,email:false},
            webhook:"http://127.0.0.1:5501/hooktest", active:true, _last:null };
  fireAlert(a, 123.45, 0);
  return true;
});
await p.waitForTimeout(600);
console.log("Webhook POST sent:", webhookHit!==null, webhookHit? ("payload="+webhookHit) : "(no request — no-cors may hide it)");

await b.close();
process.exit(fail?1:0);
