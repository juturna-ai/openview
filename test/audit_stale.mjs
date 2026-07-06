import { chromium } from 'playwright';
const b=await chromium.launch({headless:true}); const p=await b.newPage();
await p.goto("http://127.0.0.1:5501/",{waitUntil:"domcontentloaded",timeout:20000});
await p.waitForTimeout(4500);
const r=await p.evaluate(()=>({
  flyoutCats: document.querySelectorAll('.tool.cat').length,           // left-rail flyout submenus
  bottomBar: !!document.getElementById('bottomBar'),                   // bottom bar exists
  rangeShortcuts: document.querySelectorAll('#rangeShortcuts .rng').length,
  tzInBottom: !!(document.getElementById('bottomRight')&&document.getElementById('bottomRight').querySelector('#tzSel')),
  scaleInBottom: !!(document.getElementById('bottomRight')&&document.getElementById('bottomRight').querySelector('#btnScale')),
  rightRail: document.querySelectorAll('#rightRail .rr-btn').length,   // right sidebar tabs
  replayBtn: !!document.getElementById('btnReplay'),
  layoutSel: !!document.getElementById('layoutSel'),
}));
console.log(JSON.stringify(r));
await b.close();
