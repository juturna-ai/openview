import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(4500);
await p.evaluate(()=>{ try{localStorage.removeItem('fv_tool_favs');}catch(e){} });
// favorite 'fib' via API
const res=await p.evaluate(()=>{ toggleToolFav('fib'); return { favs:TOOL_FAVS.slice(), saved:localStorage.getItem('fv_tool_favs') }; });
await p.waitForTimeout(300);
// rail should now have a pinned fib button at top (data-tool=fib, not a cat)
const pinnedFib=await p.locator('#toolbar .tool[data-tool="fib"]:not(.cat)').count();
// reload → persists
await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(3800);
const afterReload=await p.locator('#toolbar .tool[data-tool="fib"]:not(.cat)').count();
console.log(JSON.stringify({res, pinnedFib, afterReload, persists: afterReload>0, appErrors:errs.slice(0,4)}));
await b.close();
