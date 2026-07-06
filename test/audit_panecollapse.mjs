import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
const errs=[]; p.on('pageerror',e=>{ if(!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(5000);
await p.evaluate(()=>addIndicator('macd'));
await p.waitForTimeout(1000);
const el='.subpane';
const h0=await p.evaluate(()=>Math.round(document.querySelector('.subpane').getBoundingClientRect().height));
// collapse
const collapseBtns=await p.locator('.subpane .subLabel .subClose').allInnerTexts();
await p.evaluate(()=>{ const el=document.querySelector('.subpane'); togglePaneCollapse(el); });
await p.waitForTimeout(300);
const hCollapsed=await p.evaluate(()=>Math.round(document.querySelector('.subpane').getBoundingClientRect().height));
// restore then maximize
await p.evaluate(()=>{ const el=document.querySelector('.subpane'); togglePaneCollapse(el); togglePaneMaximize(el); });
await p.waitForTimeout(300);
const hMaxed=await p.evaluate(()=>Math.round(document.querySelector('.subpane').getBoundingClientRect().height));
console.log(JSON.stringify({h0, collapseBtns, hCollapsed, collapsed: hCollapsed<40, hMaxed, maxed: hMaxed>h0, appErrors:errs.slice(0,4)}));
await b.close();
