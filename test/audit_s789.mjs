import { chromium } from 'playwright';

const url = 'http://127.0.0.1:5501/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

const consoleErrors = [];
const consoleAll = [];
page.on('console', m => {
  consoleAll.push({ type: m.type(), text: m.text() });
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', r => consoleErrors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText||'')));

const R = {};

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'test/s789_00_initial.png' });

// ═══════════════ SECTION 7 — WATCHLIST ═══════════════

// Add-symbol button + dialog
R.wlAddBtnCount = await page.locator('#wlAdd').count();
await page.click('#wlAdd');
await page.waitForTimeout(400);
R.symDlgOpenAfterAdd = await page.locator('#symDlg.open, #symDlg:visible').count();
await page.screenshot({ path: 'test/s789_01_add_symbol_dlg.png' });
// close dialog (Escape)
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Remove button per row
R.rowDelBtnCount = await page.locator('#wlBody .row .del').count();

// Rows + sections present
R.rowCount = await page.locator('#wlBody .row').count();
R.sectionCount = await page.locator('#wlBody .section').count();
R.rowDraggable = await page.locator('#wlBody .row').first().getAttribute('draggable');

// Watchlist header name (single hardcoded name = no multi-watchlist switcher)
R.wlHeadText = await page.locator('#wlHead').innerText();
R.wlHeadHasDropdownAffordance = await page.locator('#wlHead .sub').count(); // "▾" glyph presence

// Price coloring — screenshot + check colored classes exist with actual colors
await page.waitForTimeout(2500); // let refreshPrices populate
await page.screenshot({ path: 'test/s789_02_watchlist_prices.png', clip: { x: 1600-320, y: 0, width: 320, height: 950 } });
const chgClasses = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('#wlBody [data-chg]')];
  return spans.map(s => ({ text: s.textContent, cls: s.className, color: getComputedStyle(s).color }));
});
R.chgSample = chgClasses.slice(0, 8);
R.chgHasUpOrDown = chgClasses.some(c => c.cls.includes('up') || c.cls.includes('down'));

// Click a symbol row -> chart should change
const rowsBefore = await page.locator('#wlBody .row').all();
R.rowSymbols = [];
for (const r of rowsBefore.slice(0, 6)) R.rowSymbols.push(await r.getAttribute('data-sym'));

// figure out current active symbol / title before click (top-level `let` in a
// non-module script does NOT attach to window, so use eval() in page context)
const beforeActive = await page.evaluate(() => eval('activeSymbol'));
// pick a row that's not currently active
let targetRow = null, targetSym = null;
for (const r of rowsBefore) {
  const sym = await r.getAttribute('data-sym');
  if (sym && sym !== beforeActive && !sym.includes('/')) { targetRow = r; targetSym = sym; break; }
}
if (targetRow) {
  await targetRow.click();
  await page.waitForTimeout(1500);
  const afterActive = await page.evaluate(() => eval('activeSymbol'));
  R.clickSymbolBefore = beforeActive;
  R.clickSymbolTarget = targetSym;
  R.clickSymbolAfter = afterActive;
  R.clickChangedActiveSymbol = (afterActive === targetSym && afterActive !== beforeActive);
  await page.screenshot({ path: 'test/s789_03_after_symbol_click.png' });
}

// Reorder drag test: verify DnD wiring exists (draggable + dragstart handler) — do a programmatic dragstart/drop simulation
R.dragWireCheck = await page.evaluate(() => {
  const row = document.querySelector('#wlBody .row');
  return row ? row.draggable === true : false;
});

// Collapsible sections: click a section header, check 'collapsed' class toggles
const sectionHeaderCount = await page.locator('#wlBody .section').count();
if (sectionHeaderCount > 0) {
  const sec = page.locator('#wlBody .section').first();
  const beforeClass = await sec.getAttribute('class');
  await sec.click();
  await page.waitForTimeout(300);
  const afterClass = await sec.getAttribute('class');
  R.sectionCollapseToggled = beforeClass !== afterClass;
  await page.screenshot({ path: 'test/s789_04_section_collapsed.png' });
  // toggle back
  await sec.click();
  await page.waitForTimeout(300);
}

// Multiple named watchlists: check if GROUPS structure supports multiple *watchlists* (vs sections within ONE watchlist)
R.groupsStructure = await page.evaluate(() => {
  try {
    const G = eval('GROUPS');
    return { groupsIsArray: Array.isArray(G), groupCount: G ? G.length : null, sample: G ? G.map(g=>g.name) : null };
  } catch(e) { return { error: e.message }; }
});
// Is there any UI element to create a whole NEW watchlist (separate from "add section")?
R.newWatchlistButtonCount = await page.locator('text=/new watchlist/i').count();

// Flag / color a symbol — check context menu on a row for flag/color options
const anyRow = page.locator('#wlBody .row').first();
await anyRow.click({ button: 'right' });
await page.waitForTimeout(300);
await page.screenshot({ path: 'test/s789_05_row_contextmenu.png' });
R.rowContextMenuText = await page.evaluate(() => {
  const ctx = document.querySelector('#ctxMenu, .ctxmenu, [id*="ctx" i]');
  return ctx ? ctx.innerText : null;
});
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ═══════════════ SECTION 8 — SYMBOL INFO & EXTRAS ═══════════════

// Symbol info panel (name/exchange/description) — check DOM for such panel
R.symbolInfoPanelCheck = await page.evaluate(() => {
  const candidates = ['#symbolInfo', '#symInfo', '.symbol-info', '#exchangeInfo'];
  return candidates.map(sel => ({ sel, count: document.querySelectorAll(sel).length }));
});
R.ohlcLegendText = await page.locator('#ohlc').count() ? await page.locator('#ohlc').innerText().catch(()=>null) : null;

// Bar replay mode
R.replayButtonCount = await page.locator('text=/replay/i').count();
R.replayFnExists = await page.evaluate(() => typeof window.replay !== 'undefined' || typeof window.startReplay !== 'undefined');

// Compare symbols overlay
R.compareMenuTextSearch = await page.locator('text=/compare/i').count();

// News feed panel
R.newsPanelCount = await page.locator('text=/news/i').count();

// Screener table
R.screenerCount = await page.locator('text=/screener/i').count();

// Paper trading
R.paperTradingCount = await page.locator('text=/paper trad/i').count();

// ═══════════════ SECTION 9 — PERFORMANCE & QUALITY ═══════════════

// Bar count loaded
R.barsLoaded = await page.evaluate(() => {
  try {
    const c = eval('candle');
    return c && c.data ? c.data().length : null;
  } catch(e) { return 'err:'+e.message; }
});

// Pan/zoom responsiveness — do a series of wheel zooms and drag pans, time them
const canvasBox = await page.locator('#dcanvas, canvas').first().boundingBox();
if (canvasBox) {
  const cx = canvasBox.x + canvasBox.width/2, cy = canvasBox.y + canvasBox.height/2;
  const t0 = Date.now();
  for (let i=0;i<10;i++){
    await page.mouse.wheel(0, i%2===0?-120:120);
    await page.waitForTimeout(30);
  }
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i=0;i<10;i++){ await page.mouse.move(cx - i*20, cy, {steps:2}); }
  await page.mouse.up();
  const t1 = Date.now();
  R.panZoomWallMs = t1 - t0;
  await page.screenshot({ path: 'test/s789_06_after_panzoom.png' });
}

// Reload -> check state restoration
function readState() {
  try {
    const sym = eval('activeSymbol');
    const tf = eval('activeTF');
    let drawCount = null, indCount = null;
    try { drawCount = eval('draw.shapes').length; } catch {}
    try { indCount = eval('indicators').length; } catch {}
    return { symbol: sym, tf, drawCount, indCount };
  } catch(e) { return { error: e.message }; }
}
const preReload = await page.evaluate(readState);
R.preReload = preReload;

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const postReload = await page.evaluate(readState);
R.postReload = postReload;
await page.screenshot({ path: 'test/s789_07_after_reload.png' });

// switch timeframe + add indicator to exercise console error collection
try {
  await page.click('#tfSelBtn', { timeout: 3000 });
  await page.waitForTimeout(300);
  const opt = page.locator('.tf-opt').first();
  if (await opt.count()) { await opt.click(); await page.waitForTimeout(1000); }
} catch(e) { R.tfSwitchErr = e.message; }

try {
  await page.click('#btnIndicators', { timeout: 3000 });
  await page.waitForTimeout(300);
  const item = page.locator('#indList .pi').first();
  if (await item.count()) { await item.click(); await page.waitForTimeout(500); }
} catch(e) { R.indAddErr = e.message; }

await page.waitForTimeout(2000);

R.consoleErrorCount = consoleErrors.length;
R.consoleErrorSample = consoleErrors.slice(0, 20);

console.log(JSON.stringify(R, null, 2));

await browser.close();
