import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(4500);
await p.locator('#symbolBox').click(); await p.waitForTimeout(400);
const tabs=await p.locator('#symDlg .symtab, #symDlg [data-venue], .symdlg .symtab').allInnerTexts().catch(()=>[]);
const anyTabs=await p.evaluate(()=>{ const d=document.getElementById('symDlg'); return d? Array.from(d.querySelectorAll('*')).filter(e=>/All|Coinbase|Binance|Bybit|Stocks/.test(e.textContent)&&e.children.length===0).map(e=>e.textContent.trim()).slice(0,6):[]; });
console.log(JSON.stringify({tabs, anyTabs}));
await b.close();
