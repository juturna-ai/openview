// Regression: Fib retracement TradingView-parity settings dialog.
// Draws a fib, opens settings, asserts the 3 tabs + 24 default levels/colors exist,
// edits a level + toggles one color, and verifies per-shape config persists to render.
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>{if(!/Value is null/.test(e.message))errs.push('PAGEERR: '+e.message);}); // 'Value is null' = pre-existing transient reload render (unrelated to fib)
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const box = await page.locator('#draw').boundingBox();
const cx=box.x+box.width*0.4, cy=box.y+box.height*0.35;

// draw a fib retracement
await page.locator('.tool[data-tool="fib"]').click();
await page.mouse.move(cx,cy); await page.mouse.down();
await page.mouse.move(cx+120,cy+160,{steps:6}); await page.mouse.up();
await page.waitForTimeout(300);

const res={};
res.shapeCount = await page.evaluate(()=>draw.shapes.filter(s=>s.type==='fib').length);
res.hasCfg = await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib'); return !!(s&&s.fib&&s.fib.levels);});
res.levelCount = await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib'); return s.fib.levels.length;});
res.firstLevel = await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib'); return s.fib.levels[0];});
res.defaultExtend = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.extend);

// open settings dialog
await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib'); openFibSettings(s.id);});
await page.waitForTimeout(200);
res.tabs = await page.$$eval('#settingsDlg .dtab',els=>els.map(e=>e.textContent.trim()));
res.levelRows = await page.$$eval('#settingsDlg .fib-lvl',els=>els.length);
res.hasTrend = await page.evaluate(()=>!!document.getElementById('fib_trend'));
res.hasExtend = await page.evaluate(()=>!!document.getElementById('fib_extend'));
res.hasOneColor = await page.evaluate(()=>!!document.getElementById('fib_oneon'));
res.hasCoords = await page.evaluate(()=>!!document.getElementById('fib_p1'));
res.hasVis = await page.evaluate(()=>document.querySelectorAll('#settingsDlg .fib-vis').length);

// default show: only levels with 0<=v<=1 are checked
res.defaultShow = await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib');
  return s.fib.levels.map(l=>({v:l.v, show:l.show}));});
res.allInRangeChecked = res.defaultShow.filter(l=>l.v>=0&&l.v<=1).every(l=>l.show===true);
res.allOutRangeUnchecked = res.defaultShow.filter(l=>l.v>1).every(l=>l.show===false);
res.valuesPreserved = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.levels.length)===48;

// pagination: page indicator + arrows, page 2 sorted ascending
res.page1Vals = await page.$$eval('#fib_grid .fib-lv-val',els=>els.map(e=>parseFloat(e.value)));
res.page1Sorted = res.page1Vals.every((v,i,a)=>i===0||a[i-1]<=v);
res.page1First = res.page1Vals[0]; res.page1Last = res.page1Vals[res.page1Vals.length-1];
res.pageInd = await page.evaluate(()=>document.getElementById('fib_pageind')?.textContent);
res.prevDisabled = await page.evaluate(()=>document.getElementById('fib_prev')?.disabled);
res.nextEnabled = await page.evaluate(()=>document.getElementById('fib_next') && !document.getElementById('fib_next').disabled);
// go to page 2 and read the value input order
await page.evaluate(()=>document.getElementById('fib_next').click());
await page.waitForTimeout(120);
res.pageIndAfter = await page.evaluate(()=>document.getElementById('fib_pageind')?.textContent);
res.nextDisabledOnP2 = await page.evaluate(()=>document.getElementById('fib_next')?.disabled);
res.page2Vals = await page.$$eval('#fib_grid .fib-lv-val',els=>els.map(e=>parseFloat(e.value)));
res.page2Checked = await page.$$eval('#fib_grid .fib-lv-show',els=>els.map(e=>e.checked));
res.page2Rows = res.page2Vals.length;
res.page2AllHigher = res.page2Vals.every(v=>v>3.382);      // continuation, no page-1 overlap
res.page2Sorted = res.page2Vals.every((v,i,a)=>i===0||a[i-1]<=v);
res.page2NoneChecked = res.page2Checked.every(c=>c===false);
res.page1FirstVal = 0; // reference
// back to page 1
await page.evaluate(()=>document.getElementById('fib_prev').click());
await page.waitForTimeout(120);
res.backToP1 = await page.evaluate(()=>document.getElementById('fib_pageind')?.textContent);

// edit level[1] value + color, toggle useOneColor, then apply via Ok
await page.evaluate(()=>{
  const val=document.querySelector('.fib-lv-val[data-i="1"]'); val.value='0.99'; val.dispatchEvent(new Event('input',{bubbles:true}));
  const col=document.querySelector('.fib-lv-col[data-i="1"]'); col.value='#123456'; col.dispatchEvent(new Event('input',{bubbles:true}));
  const one=document.getElementById('fib_oneon'); one.checked=true; one.dispatchEvent(new Event('input',{bubbles:true}));
  const ext=document.getElementById('fib_extend'); ext.value='both'; ext.dispatchEvent(new Event('input',{bubbles:true}));
});
await page.locator('#dlgOk').click();
await page.waitForTimeout(200);

res.editedVal = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.levels[1].v);
res.editedCol = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.levels[1].c);
res.oneColorOn = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.useOneColor);
res.extendSaved = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.extend);

// persistence: reload and confirm config survives localStorage round-trip
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForTimeout(3500);
res.persistedVal = await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib'); return s?s.fib.levels[1].v:null;});

console.log(JSON.stringify(res,null,2));
const ok = res.shapeCount===1 && res.hasCfg && res.levelCount===48
  && res.firstLevel.v===0 && res.firstLevel.c.toLowerCase()==='#e53935' && res.firstLevel.show===true
  && res.defaultExtend==='none'
  && res.tabs.join(',')==='Style,Coordinates,Visibility'
  && res.levelRows===24 && res.hasTrend && res.hasExtend && res.hasOneColor && res.hasCoords && res.hasVis===8
  && res.allInRangeChecked && res.allOutRangeUnchecked && res.valuesPreserved
  && res.pageInd==='Page 1 / 2' && res.prevDisabled===true && res.nextEnabled
  && res.pageIndAfter==='Page 2 / 2' && res.nextDisabledOnP2===true
  && res.page1Sorted && res.page1First===0 && res.page1Last===3.382
  && res.page2Rows===24 && res.page2Sorted && res.page2AllHigher && res.page2NoneChecked && res.backToP1==='Page 1 / 2'
  && res.editedVal===0.99 && res.editedCol==='#123456' && res.oneColorOn===true && res.extendSaved==='both'
  && res.persistedVal===0.99;
console.log('ERRORS:',errs.length?errs:'none');
console.log(ok && !errs.length ? 'PASS ✅' : 'FAIL ❌');
await browser.close();
process.exit(ok && !errs.length ? 0 : 1);
