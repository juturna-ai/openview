import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('console',m=>{if(m.type()==='error'&&!/HTTP|404|429|Failed to load resource/.test(m.text()))errs.push(m.text());});
page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
// move mouse over chart so draw.mouse is set for Alt+H
const box=await page.locator('#draw').boundingBox();
await page.mouse.move(box.x+box.width*0.5, box.y+box.height*0.4);

// ARROW pan
const scroll0=await page.evaluate(()=>chart.timeScale().scrollPosition());
await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
const scrollL=await page.evaluate(()=>chart.timeScale().scrollPosition());
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
const scrollR=await page.evaluate(()=>chart.timeScale().scrollPosition());

// ZOOM +/-
const span0=await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange(); return r.to-r.from;});
await page.keyboard.press('-'); await page.waitForTimeout(200);
const spanOut=await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange(); return r.to-r.from;});
await page.keyboard.press('+'); await page.keyboard.press('+'); await page.waitForTimeout(200);
const spanIn=await page.evaluate(()=>{const r=chart.timeScale().getVisibleLogicalRange(); return r.to-r.from;});

// ALT+H hline
const shapes0=await page.evaluate(()=>draw.shapes.length);
await page.mouse.move(box.x+box.width*0.5, box.y+box.height*0.35);
await page.keyboard.down('Alt'); await page.keyboard.press('h'); await page.keyboard.up('Alt');
await page.waitForTimeout(200);
const shapes1=await page.evaluate(()=>({n:draw.shapes.length, last:draw.shapes[draw.shapes.length-1]?.type}));

console.log(JSON.stringify({
  panLeft: scroll0!==scrollL, panRight: scrollL!==scrollR, scroll0, scrollL, scrollR,
  zoomOut: spanOut>span0, zoomIn: spanIn<spanOut, span0:Math.round(span0), spanOut:Math.round(spanOut), spanIn:Math.round(spanIn),
  altH_added: shapes1.n>shapes0, altH_type: shapes1.last,
  appErrors:errs.slice(0,6)
},null,2));
await browser.close();
