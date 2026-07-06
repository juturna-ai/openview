import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(4500);
await p.evaluate(()=>applyTheme(true));
await p.waitForTimeout(600);
const c=await p.evaluate(()=>({
  htmlLight: document.documentElement.classList.contains('light'),
  toolbarBg: getComputedStyle(document.getElementById('toolbar')).backgroundColor,
  watchlistBg: getComputedStyle(document.getElementById('watchlist')).backgroundColor,
  topbarBg: getComputedStyle(document.getElementById('topbar')).backgroundColor,
  bodyText: getComputedStyle(document.body).color,
  varBg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
}));
console.log(JSON.stringify(c,null,2));
await b.close();
