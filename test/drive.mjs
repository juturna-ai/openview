// Reusable Playwright driver for Freeview audit.
// Usage: node drive.mjs  -> loads app, dumps a structured snapshot of the UI
// (toolbar buttons, menu contents, left-tool count, panes) as JSON so an
// auditor can check feature presence without re-launching per check.
import { chromium } from 'playwright';
const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
await page.goto(URL, { waitUntil:'domcontentloaded', timeout:20000 });
await page.waitForTimeout(3500);

async function menuItems(openSel, itemSel){
  try{ await page.locator(openSel).first().click({timeout:2500}); await page.waitForTimeout(300);
       const items = await page.locator(itemSel).allInnerTexts();
       await page.keyboard.press('Escape').catch(()=>{});
       return items.map(s=>s.trim()).filter(Boolean);
  }catch(e){ return ['<open failed: '+openSel+'>']; }
}

const snap = {};
snap.title = await page.title();
snap.topbarButtons = (await page.locator('.topbar, #topbar, header').first().locator('button, [role=button], .btn').allInnerTexts().catch(()=>[])).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,40);
snap.tfMenu = await menuItems('#tfSelBtn, .tf-sel', '.tf-opt');
snap.chartTypeMenu = await menuItems('#ctSelBtn, [id*=ctSel], .ct-sel', '.ct-opt, [data-ct]');
snap.leftToolCount = await page.locator('.tool, .draw-tool, [data-tool], .side-tool').count();
snap.leftToolTitles = (await page.locator('.tool, .draw-tool, [data-tool], .side-tool').evaluateAll(els=>els.map(e=>e.getAttribute('title')||e.getAttribute('data-tool')||'').filter(Boolean))).slice(0,60);
snap.canvasCount = await page.locator('canvas').count();
snap.hasRSIpane = (await page.locator('text=RSI').count())>0;
snap.consoleErrors = errors.slice(0,15);
console.log(JSON.stringify(snap,null,2));
await browser.close();
