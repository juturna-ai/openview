import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.setViewportSize({width:1520,height:820});
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4500);

// find the actual date-strip point under the BOTTOM pane (RSI present by default)
const pt = await page.evaluate(()=>{
  const list=allPaneCharts(); const c=list[list.length-1];
  const el=(c===chart)?chartEl:(c===rsiChart?rsiEl:(indicators.find(i=>i.subChart===c)||scripts.find(s=>s.subChart===c)||{}).paneEl);
  const r=el.getBoundingClientRect();
  let taxH=28,axisW=64;
  try{taxH=c.timeScale().height()||28;}catch(e){}
  try{axisW=c.priceScale('right').width()||64;}catch(e){}
  return { x:r.left+(r.width-axisW)/2, y:r.bottom-taxH/2, isMain:c===chart, taxH };
});

const span0 = await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange();return r?r.to-r.from:null;});

// drag LEFT → expand
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await page.mouse.move(pt.x-250, pt.y, {steps:12});
await page.mouse.up();
await page.waitForTimeout(400);
const spanLeft = await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange();return r?r.to-r.from:null;});

// drag RIGHT → compress
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await page.mouse.move(pt.x+250, pt.y, {steps:12});
await page.mouse.up();
await page.waitForTimeout(400);
const spanRight = await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange();return r?r.to-r.from:null;});

// hover applies the resize class
await page.mouse.move(pt.x, pt.y);
await page.waitForTimeout(150);
const hoverClass = await page.evaluate(()=>document.body.classList.contains('time-resize'));

// class persists mid-drag (even when pointer leaves the strip vertically)
await page.mouse.down();
await page.mouse.move(pt.x-120, pt.y-200, {steps:6});
const dragClass = await page.evaluate(()=>document.body.classList.contains('time-resize'));
await page.mouse.up();
const afterUpClass = await page.evaluate(()=>document.body.classList.contains('time-resize'));

console.log(JSON.stringify({
  bottomPaneIsMain: pt.isMain, taxH: pt.taxH,
  span0:Math.round(span0), spanAfterDragLeft:Math.round(spanLeft), spanAfterDragRight:Math.round(spanRight),
  dragLeftExpanded: spanLeft>span0, dragRightCompressed: spanRight<spanLeft,
  hoverClass, dragClassPersists: dragClass, clearedAfterUp: !afterUpClass,
  appErrors:errs.slice(0,6)
},null,2));
await browser.close();
