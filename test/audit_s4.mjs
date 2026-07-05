import { chromium } from 'playwright';

const url = 'http://127.0.0.1:5501/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

const results = {};

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'test/s4_00_initial.png' });

// ── Open Indicators dialog ──
results.btnIndicatorsCount = await page.locator('#btnIndicators').count();
await page.click('#btnIndicators');
await page.waitForTimeout(300);
results.menuOpen = await page.locator('#indicatorsMenu.open').count();
results.searchInputCount = await page.locator('#indSearch').count();
await page.screenshot({ path: 'test/s4_01_menu_open.png' });

// ── Enumerate full catalog (name + category + pane type) ──
const catalog = await page.evaluate(() => IND_CATALOG.map(c => ({ type: c.type, name: c.name, cat: c.cat, pane: c.pane })));
results.catalog = catalog;
results.catalogCount = catalog.length;

// ── Dump rendered list items grouped by category ──
const renderedItems = await page.locator('#indList .pi span:first-child').allTextContents();
results.renderedItems = renderedItems;
const renderedCats = await page.locator('#indList .indcat').allTextContents();
results.renderedCats = renderedCats;

// ── Test search filter ──
await page.fill('#indSearch', 'rsi');
await page.waitForTimeout(200);
results.searchRsiMatches = await page.locator('#indList .pi span:first-child').allTextContents();
await page.screenshot({ path: 'test/s4_02_search_rsi.png' });
await page.fill('#indSearch', '');
await page.waitForTimeout(200);

// helper: click a catalog item by exact name in the first span
async function clickIndicator(name) {
  const item = page.locator('#indList .pi').filter({ has: page.locator(`span:text-is("${name}")`) });
  await item.first().click();
}

// ── Add RSI ──
await page.evaluate(() => { document.querySelector('#indSearch').value=''; });
await clickIndicator('RSI');
await page.waitForTimeout(600);
results.indicatorsAfterRsi = await page.evaluate(() => indicators.map(i => ({ id: i.id, type: i.type, pane: i.pane })));
await page.screenshot({ path: 'test/s4_03_after_rsi.png' });

// ── Add RSI a second time (test multiple instances) ──
await page.click('#btnIndicators');
await page.waitForTimeout(200);
await clickIndicator('RSI');
await page.waitForTimeout(600);
results.indicatorsAfterRsiTwice = await page.evaluate(() => indicators.map(i => ({ id: i.id, type: i.type, pane: i.pane })));
results.rsiInstanceCount = await page.evaluate(() => indicators.filter(i=>i.type==='rsi').length);
const subPaneCountAfter2Rsi = await page.locator('.subpane').count();
results.subPaneCountAfter2Rsi = subPaneCountAfter2Rsi;
await page.screenshot({ path: 'test/s4_04_after_rsi_twice.png' });

// ── Add MACD ──
await page.click('#btnIndicators');
await page.waitForTimeout(200);
await clickIndicator('MACD');
await page.waitForTimeout(600);

// ── Add Bollinger Bands ──
await page.click('#btnIndicators');
await page.waitForTimeout(200);
await clickIndicator('Bollinger Bands');
await page.waitForTimeout(600);

// ── Add VWAP ──
await page.click('#btnIndicators');
await page.waitForTimeout(200);
await clickIndicator('VWAP');
await page.waitForTimeout(600);

// ── Add Volume ──
await page.click('#btnIndicators');
await page.waitForTimeout(200);
await clickIndicator('Volume');
await page.waitForTimeout(800);

results.indicatorsFinal = await page.evaluate(() => indicators.map(i => ({ id: i.id, type: i.type, pane: i.pane, seriesCount: i.series.length })));
results.subPaneCountFinal = await page.locator('.subpane').count();
results.mainLegendRows = await page.locator('#indLegend .indrow .nm').allTextContents();
await page.screenshot({ path: 'test/s4_05_multi_added.png', fullPage: false });

// ── Indicator settings dialog ──
// Open settings (gear) on the first main-legend indicator row (BB or VWAP)
const gearBtn = page.locator('#indLegend .indrow .gear').first();
results.gearBtnCount = await gearBtn.count();
if (await gearBtn.count()) {
  await gearBtn.click({ force: true });
  await page.waitForTimeout(300);
  results.settingsDlgOpen = await page.locator('#settingsDlg.open').count().catch(()=>0);
  results.settingsFields = await page.locator('#settingsDlg .field label').allTextContents().catch(()=>[]);
  await page.screenshot({ path: 'test/s4_06_settings_dlg.png' });
  // change color if present
  const colorInput = page.locator('#settingsDlg input[type="color"]');
  if (await colorInput.count()) {
    await colorInput.first().fill('#ff00ff');
    await page.waitForTimeout(300);
    results.colorChangedApplied = await page.evaluate(() => {
      const ind = indicators.find(i=>i.params && i.params.color);
      return ind ? ind.params.color : null;
    });
  }
  await page.click('#dlgOk').catch(()=>{});
  await page.waitForTimeout(300);
}

// settings gear on a sub-pane indicator (RSI)
const subGear = page.locator('.subpane .subLabel .subClose[title="Settings"]').first();
results.subGearCount = await subGear.count();
if (await subGear.count()) {
  await subGear.click({ force: true });
  await page.waitForTimeout(300);
  results.subSettingsDlgOpen = await page.locator('#settingsDlg.open').count().catch(()=>0);
  results.subSettingsFields = await page.locator('#settingsDlg .field label').allTextContents().catch(()=>[]);
  await page.screenshot({ path: 'test/s4_07_sub_settings_dlg.png' });
  await page.click('#dlgCancel').catch(()=>{});
  await page.waitForTimeout(200);
}

// ── Pane resize by dragging divider ──
// Check for any resize-handle element between subpanes
results.resizeHandleSelectors = await page.evaluate(() => {
  const sel = ['.pane-resizer', '.subpane-resizer', '.resize-handle', '.divider', '[class*="resiz" i]'];
  return sel.map(s => ({ sel: s, count: document.querySelectorAll(s).length }));
});
// try manual drag between two subpanes and see if height changes
const subpanes = page.locator('.subpane');
const spCount = await subpanes.count();
results.subpaneCountForResizeTest = spCount;
if (spCount >= 2) {
  const first = subpanes.nth(0);
  const box1Before = await first.boundingBox();
  // attempt drag at boundary between pane 0 and pane 1
  const second = subpanes.nth(1);
  const box2 = await second.boundingBox();
  if (box1Before && box2) {
    const boundaryY = box2.y; // top edge of second pane = bottom edge of first
    await page.mouse.move(box1Before.x + 50, boundaryY);
    await page.mouse.down();
    await page.mouse.move(box1Before.x + 50, boundaryY - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const box1After = await first.boundingBox();
    results.paneResizeHeightBefore = box1Before.height;
    results.paneResizeHeightAfter = box1After.height;
    results.paneResizeChanged = Math.abs(box1After.height - box1Before.height) > 2;
  }
}

// ── Hide/show/remove from legend ──
results.legendRowHtml = await page.locator('#indLegend .indrow').first().evaluate(el => el.outerHTML).catch(()=>null);
results.hasEyeOrHideControl = await page.evaluate(() => {
  const box = document.getElementById('indLegend');
  return box ? /eye|hide|visib/i.test(box.innerHTML) : false;
});
// test remove (x) on a main legend row
const legendCountBefore = await page.locator('#indLegend .indrow').count();
const xBtn = page.locator('#indLegend .indrow .x').first();
if (await xBtn.count()) {
  await xBtn.click({ force: true });
  await page.waitForTimeout(400);
}
const legendCountAfter = await page.locator('#indLegend .indrow').count();
results.legendRemoveWorked = legendCountAfter < legendCountBefore;
results.legendCountBefore = legendCountBefore;
results.legendCountAfter = legendCountAfter;
await page.screenshot({ path: 'test/s4_08_after_remove.png' });

// ── Crosshair hover -> legend value updates ──
// hover over chart area and check OHLC legend + RSI legend value text before/after
const chartArea = page.locator('#chart, #chartWrap, .chartwrap').first();
const chartBox = await page.locator('#chart').first().boundingBox().catch(()=>null) || await page.locator('canvas').first().boundingBox().catch(()=>null);
results.chartBoxFound = !!chartBox;
if (chartBox) {
  const rsiValBefore = await page.locator('#rsiVal').textContent().catch(()=>null);
  await page.mouse.move(chartBox.x + chartBox.width*0.3, chartBox.y + chartBox.height*0.5);
  await page.waitForTimeout(300);
  const ohlcAfterHover1 = await page.locator('#ohlc').innerHTML().catch(()=>null);
  const rsiValAfterHover1 = await page.locator('#rsiVal').textContent().catch(()=>null);
  await page.mouse.move(chartBox.x + chartBox.width*0.7, chartBox.y + chartBox.height*0.5);
  await page.waitForTimeout(300);
  const ohlcAfterHover2 = await page.locator('#ohlc').innerHTML().catch(()=>null);
  const rsiValAfterHover2 = await page.locator('#rsiVal').textContent().catch(()=>null);
  results.ohlcAfterHover1 = ohlcAfterHover1;
  results.ohlcAfterHover2 = ohlcAfterHover2;
  results.ohlcChangedOnHover = ohlcAfterHover1 !== ohlcAfterHover2;
  results.rsiValBefore = rsiValBefore;
  results.rsiValAfterHover1 = rsiValAfterHover1;
  results.rsiValAfterHover2 = rsiValAfterHover2;
  results.rsiValChangedOnHover = rsiValAfterHover1 !== rsiValAfterHover2;

  // check indLegend rows for any value text (vals class) change on hover — should be static (name+params only)
  results.indLegendRowsTextAfterHover1 = await page.locator('#indLegend .indrow').allTextContents();
  await page.mouse.move(chartBox.x + chartBox.width*0.3, chartBox.y + chartBox.height*0.5);
  await page.waitForTimeout(300);
  results.indLegendRowsTextAfterHover2 = await page.locator('#indLegend .indrow').allTextContents();
  results.indLegendValsClassCount = await page.locator('#indLegend .vals').count();
  await page.screenshot({ path: 'test/s4_09_hover.png' });
}

// ── Persistence check: reload and see if indicators survive ──
results.indicatorsBeforeReload = await page.evaluate(() => indicators.map(i=>i.type));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
results.indicatorsAfterReload = await page.evaluate(() => typeof indicators !== 'undefined' ? indicators.map(i=>i.type) : null);
results.subPaneCountAfterReload = await page.locator('.subpane').count();

// dump ALL localStorage keys to check for any indicator-related persistence
results.localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
results.localStorageDump = await page.evaluate(() => {
  const o = {};
  for (const k of Object.keys(localStorage)) o[k] = localStorage.getItem(k).slice(0, 300);
  return o;
});

console.log(JSON.stringify(results, null, 2));
console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors, null, 2));

await browser.close();
