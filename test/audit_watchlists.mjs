import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>{ try{ ['fv_watchlists','fv_active_wl'].forEach(k=>localStorage.removeItem(k)); }catch(e){} location.reload(); });
await p.waitForTimeout(5000);

const initName=await p.evaluate(()=>ACTIVE_WL);
const initGroups=await p.evaluate(()=>GROUPS.length);
// create a new watchlist via API (prompt stubbed)
const created=await p.evaluate(()=>{ window.prompt=()=>"Crypto Majors"; createWatchlist(); return {active:ACTIVE_WL, groups:GROUPS.length, names:Object.keys(WATCHLISTS)}; });
// switch back to comeback
await p.evaluate(()=>switchWatchlist('comeback'));
const backName=await p.evaluate(()=>ACTIVE_WL);
const backGroups=await p.evaluate(()=>GROUPS.length);
// menu present?
await p.locator('#wlNameBtn').click(); await p.waitForTimeout(300);
const menuItems=await p.locator('#wlNameMenu .mi').count();
// reload → persists which is active + both lists
await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
const afterReload=await p.evaluate(()=>({ active:ACTIVE_WL, names:Object.keys(WATCHLISTS) }));
console.log(JSON.stringify({initName, initGroups, created, backName, backGroups, menuItems, afterReload, appErrors:errs.slice(0,4)},null,2));
await b.close();
