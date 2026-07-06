// Regression: generic tabbed settings dialog for non-fib tools.
// Verifies Style/Coordinates/Visibility tabs render per-tool controls and apply.
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{if(!/Value is null/.test(e.message))errs.push('PAGEERR: '+e.message);});
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);

const box = await page.locator('#draw').boundingBox();
const cx=box.x+box.width*0.4, cy=box.y+box.height*0.4;

async function draw2(tool,dx,dy){
  await page.evaluate(t=>{ draw.tool=t; }, tool);
  await page.mouse.move(cx,cy); await page.mouse.down();
  await page.mouse.move(cx+dx,cy+dy,{steps:5}); await page.mouse.up();
  await page.waitForTimeout(250);
}
async function open(tool){
  const id=await page.evaluate(t=>{const s=[...draw.shapes].reverse().find(s=>s.type===t); openSettings(s.id); return s.id;},tool);
  await page.waitForTimeout(150); return id;
}
const R={};

// trend → has extend, tabs, coords(2), vis(8)
await draw2('trend',120,-60);
await open('trend');
R.trendTabs=await page.$$eval('#settingsDlg .dtab',e=>e.map(x=>x.textContent.trim()).join(','));
R.trendExtend=await page.evaluate(()=>!!document.getElementById('f_extend'));
R.trendCoords=await page.$$eval('#settingsDlg .c-price',e=>e.length);
R.trendVis=await page.$$eval('#settingsDlg .v-scope',e=>e.length);
await page.evaluate(()=>{const e=document.getElementById('f_extend'); e.value='both'; e.dispatchEvent(new Event('input',{bubbles:true}));});
await page.locator('#dlgOk').click(); await page.waitForTimeout(150);
R.trendExtendSaved=await page.evaluate(()=>[...draw.shapes].reverse().find(s=>s.type==='trend').style.extend);

// rect → has fill
await draw2('rect',100,80);
await open('rect');
R.rectFill=await page.evaluate(()=>!!document.getElementById('f_fill') && !!document.getElementById('f_fillcol'));
await page.evaluate(()=>{const c=document.getElementById('f_fillcol'); c.value='#00ff00'; c.dispatchEvent(new Event('input',{bubbles:true}));});
await page.locator('#dlgOk').click(); await page.waitForTimeout(150);
R.rectFillSaved=await page.evaluate(()=>{const s=[...draw.shapes].reverse().find(s=>s.type==='rect'); return s.style.fillColor;});

// text → text + textColor + fontSize
await page.evaluate(()=>{ draw.tool='text'; });
await page.mouse.click(cx+40,cy+40); await page.waitForTimeout(200);
// text tool may open an inline editor; ensure a text shape exists
await page.evaluate(()=>{ if(![...draw.shapes].some(s=>s.type==='text')){ const c={time:(lastData[lastData.length-1]?.time||0),price:0}; draw.shapes.push({id:newId(),type:'text',pts:[c],style:{...DEFAULT_STYLE},text:'Hi'}); persist(); redraw(); } });
// text tool may prompt; set text via settings
const txtId=await page.evaluate(()=>{const s=[...draw.shapes].reverse().find(s=>s.type==='text'); if(s){openSettings(s.id);return s.id;} return null;});
await page.waitForTimeout(150);
R.textHasText=await page.evaluate(()=>!!document.getElementById('f_text'));
R.textHasColor=await page.evaluate(()=>!!document.getElementById('f_textcol'));
R.textHasSize=await page.evaluate(()=>!!document.getElementById('f_fontsize'));
if(txtId){
  await page.evaluate(()=>{const c=document.getElementById('f_textcol'); c.value='#ff8800'; c.dispatchEvent(new Event('input',{bubbles:true}));
    const f=document.getElementById('f_fontsize'); f.value='20'; f.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#dlgOk').click(); await page.waitForTimeout(150);
  R.textColorSaved=await page.evaluate(()=>[...draw.shapes].reverse().find(s=>s.type==='text').style.textColor);
  R.textSizeSaved=await page.evaluate(()=>[...draw.shapes].reverse().find(s=>s.type==='text').style.fontSize);
}

// arrow → arrow toggle
await draw2('arrow',90,-30);
await open('arrow');
R.arrowHasToggle=await page.evaluate(()=>!!document.getElementById('f_arrow'));
await page.evaluate(()=>{const a=document.getElementById('f_arrow'); a.checked=false; a.dispatchEvent(new Event('input',{bubbles:true}));});
await page.locator('#dlgOk').click(); await page.waitForTimeout(150);
R.arrowSaved=await page.evaluate(()=>[...draw.shapes].reverse().find(s=>s.type==='arrow').style.arrow);

// visibility toggle persists on a shape
await open('trend');
await page.evaluate(()=>{const v=document.querySelector('.v-scope[data-k="weeks"]'); v.checked=false; v.dispatchEvent(new Event('input',{bubbles:true}));});
await page.locator('#dlgOk').click(); await page.waitForTimeout(150);
R.visSaved=await page.evaluate(()=>[...draw.shapes].reverse().find(s=>s.type==='trend').style.visibility.weeks);

console.log(JSON.stringify(R,null,2));
const ok = R.trendTabs==='Style,Coordinates,Visibility' && R.trendExtend && R.trendCoords===2 && R.trendVis===8
  && R.trendExtendSaved==='both' && R.rectFill && R.rectFillSaved==='#00ff00'
  && R.textHasText && R.textHasColor && R.textHasSize
  && (txtId? (R.textColorSaved==='#ff8800' && R.textSizeSaved===20):true)
  && R.arrowHasToggle && R.arrowSaved===false && R.visSaved===false;
console.log('ERRORS:',errs.length?errs:'none');
console.log(ok && !errs.length ? 'PASS ✅' : 'FAIL ❌');
await browser.close();
process.exit(ok && !errs.length ? 0 : 1);
