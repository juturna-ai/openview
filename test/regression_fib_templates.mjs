// Regression: Fib template menu (Save as… / Save as default / Apply defaults / named apply/delete)
// plus wider dialog with no horizontal overflow.
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const errs=[];
page.on('pageerror',e=>{if(!/Value is null/.test(e.message))errs.push('PAGEERR: '+e.message);});
await page.goto('http://127.0.0.1:5501/',{waitUntil:'domcontentloaded',timeout:20000});
await page.waitForTimeout(4000);
// clean any leftover templates from prior runs
await page.evaluate(()=>{localStorage.removeItem('fv_fib_templates'); localStorage.removeItem('fv_fib_default');});

const box=await page.locator('#draw').boundingBox();
const cx=box.x+box.width*0.4, cy=box.y+box.height*0.35;
await page.evaluate(()=>{draw.tool='fib';});
await page.mouse.move(cx,cy); await page.mouse.down();
await page.mouse.move(cx+120,cy+160,{steps:6}); await page.mouse.up();
await page.waitForTimeout(300);
const openDlg=async()=>{ await page.evaluate(()=>{const s=draw.shapes.find(s=>s.type==='fib'); openFibSettings(s.id);}); await page.waitForTimeout(150); };
await openDlg();

const R={};
// dialog is wider + no horizontal overflow in the scroll body
R.dialogWide = await page.evaluate(()=>document.getElementById('settingsDlg').classList.contains('fib-dialog'));
R.noXScroll = await page.evaluate(()=>{const db=document.querySelector('#settingsDlg .db'); return db.scrollWidth<=db.clientWidth+1;});
R.hasTplBtn = await page.evaluate(()=>!!document.getElementById('fib_tpl_btn'));

// open menu → has Save as… / Save as default / Apply defaults
await page.evaluate(()=>document.getElementById('fib_tpl_btn').click());
await page.waitForTimeout(120);
R.menuItems = await page.$$eval('#fib_tpl_menu .tpli[data-act]',els=>els.map(e=>e.dataset.act));

// Save as… (stub prompt) → template stored
await page.evaluate(()=>{ window.prompt=()=> 'My Fib'; });
await page.evaluate(()=>{ [...document.querySelectorAll('#fib_tpl_menu .tpli')].find(e=>e.dataset.act==='saveas').click(); });
await page.waitForTimeout(150);
R.tplSaved = await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('fv_fib_templates')||'{}')));

// edit a level, save as default → new fib uses it
await page.evaluate(()=>{const v=document.querySelector('.fib-lv-val[data-i="0"]'); v.value='0.05'; v.dispatchEvent(new Event('input',{bubbles:true}));});
await page.evaluate(()=>document.getElementById('fib_tpl_btn').click()); await page.waitForTimeout(100);
await page.evaluate(()=>{ [...document.querySelectorAll('#fib_tpl_menu .tpli')].find(e=>e.dataset.act==='savedef').click(); });
await page.waitForTimeout(120);
R.defaultSaved = await page.evaluate(()=>!!localStorage.getItem('fv_fib_default'));
// a brand-new fib should now inherit the saved default's first level value
R.newFibInheritsDefault = await page.evaluate(()=>defaultFibConfig().levels[0].v);

// named template appears and applies
await openDlg();
await page.evaluate(()=>document.getElementById('fib_tpl_btn').click()); await page.waitForTimeout(120);
R.namedListed = await page.$$eval('#fib_tpl_menu .tpli-named span:first-child',els=>els.map(e=>e.textContent));
// change a level then apply the saved "My Fib" (which had default level0=0) to confirm it overrides
await page.evaluate(()=>{const v=document.querySelector('.fib-lv-val[data-i="0"]'); v.value='0.77'; v.dispatchEvent(new Event('input',{bubbles:true}));});
await page.evaluate(()=>document.getElementById('fib_tpl_btn').click()); await page.waitForTimeout(120);
await page.evaluate(()=>{ [...document.querySelectorAll('#fib_tpl_menu .tpli-named')].find(e=>e.dataset.name==='My Fib').click(); });
await page.waitForTimeout(200);
R.appliedTplLevel0 = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.levels[0].v);

// Apply defaults resets to factory (level0 = 0)
await page.evaluate(()=>document.getElementById('fib_tpl_btn').click()); await page.waitForTimeout(120);
await page.evaluate(()=>{ [...document.querySelectorAll('#fib_tpl_menu .tpli')].find(e=>e.dataset.act==='applydef').click(); });
await page.waitForTimeout(200);
R.afterApplyDefaults = await page.evaluate(()=>draw.shapes.find(s=>s.type==='fib').fib.levels[0].v);

// delete the named template
await openDlg();
await page.evaluate(()=>document.getElementById('fib_tpl_btn').click()); await page.waitForTimeout(120);
await page.evaluate(()=>{ document.querySelector('#fib_tpl_menu .tpli-del').click(); });
await page.waitForTimeout(120);
R.afterDelete = await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('fv_fib_templates')||'{}')).length);

console.log(JSON.stringify(R,null,2));
const ok = R.dialogWide && R.noXScroll && R.hasTplBtn
  && R.menuItems.join(',')==='saveas,savedef,applydef'
  && R.tplSaved.includes('My Fib') && R.defaultSaved && R.newFibInheritsDefault===0.05
  && R.namedListed.includes('My Fib') && R.appliedTplLevel0===0 && R.afterApplyDefaults===0
  && R.afterDelete===0;
console.log('ERRORS:',errs.length?errs:'none');
console.log(ok && !errs.length ? 'PASS ✅' : 'FAIL ❌');
await browser.close();
process.exit(ok && !errs.length ? 0 : 1);
