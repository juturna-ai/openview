import { chromium } from 'playwright';

const url = 'http://127.0.0.1:5501/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

const results = {};

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: 'test/s2_00_initial.png' });

// ── Title / ratio symbol check ──
results.title = await page.title();
results.symName = await page.locator('#symName').textContent().catch(() => null);
results.exName = await page.locator('#exName').textContent().catch(() => null);
results.tfName = await page.locator('#tfName').textContent().catch(() => null);

// ── Timeframe menu ──
await page.click('#tfSelBtn');
await page.waitForTimeout(300);
const tfOpts = await page.locator('.tf-opt').allTextContents();
const tfOptDataI = await page.locator('.tf-opt').evaluateAll(els => els.map(e => e.dataset.i));
results.tfOptsText = tfOpts.map(s => s.trim());
results.tfOptKeys = tfOptDataI;
await page.screenshot({ path: 'test/s2_01_tfmenu.png' });

// select 5m and confirm chart reload (tfName label updates + network fetch)
let fetchSeen = false;
const onReq = req => { if (/coinbase|klines|candles|proxy/i.test(req.url())) fetchSeen = true; };
page.on('request', onReq);
const opt5m = page.locator('.tf-opt[data-i="5m"]');
const has5m = await opt5m.count();
if (has5m) {
  await opt5m.click();
  await page.waitForTimeout(2500);
  results.tfNameAfter5m = await page.locator('#tfName').textContent().catch(() => null);
  results.fetchSeenAfterTfChange = fetchSeen;
} else {
  results.tfNameAfter5m = null;
  results.fetchSeenAfterTfChange = false;
}
page.off('request', onReq);
await page.screenshot({ path: 'test/s2_02_after_5m.png' });

// reset back to 1D
await page.click('#tfSelBtn');
await page.waitForTimeout(200);
const opt1D = page.locator('.tf-opt[data-i="1d"]');
if (await opt1D.count()) { await opt1D.click(); await page.waitForTimeout(1500); }

// ── Custom timeframe input? ──
results.customTfInputCount = await page.locator('#tfSel input, .tf-menu input, #tfMenu input').count();
// check for any input elsewhere associated with tf entry
results.anyFreeTextTfInput = await page.evaluate(() => {
  return !!document.querySelector('input[placeholder*="timeframe" i], input[id*="tf" i][type="text"]');
});

// ── Symbol search dialog ──
// Try clicking a "+" / add-symbol affordance. First check watchlist/group UI.
const addSymSelectors = ['#btnAddSymbol', '.add-symbol', '[title*="Add symbol" i]', '.grp-add', '.addsym'];
let opened = false;
for (const sel of addSymSelectors) {
  const loc = page.locator(sel);
  if (await loc.count()) { await loc.first().click().catch(() => {}); await page.waitForTimeout(300); opened = true; break; }
}
if (!opened) {
  // fall back: call the app's own function directly (still verifies the dialog is real & wired, not guessing HTML)
  await page.evaluate(() => { if (typeof openAddSymbolDlg === 'function') openAddSymbolDlg(); });
  await page.waitForTimeout(300);
}
results.symDlgOpen = await page.locator('#symDlg.open, .symdlg.open').count().catch(() => 0);
const symInput = page.locator('#symInput');
results.symInputCount = await symInput.count();
if (await symInput.count()) {
  await symInput.fill('NEAR');
  await page.waitForTimeout(1500);
  results.symResultsAfterNEAR = await page.locator('#symList .symrow, #symList [data-sym], #symList li').count().catch(() => 0);
  results.symListHtmlSnippet = (await page.locator('#symList').innerHTML().catch(() => '')).slice(0, 800);
  await page.screenshot({ path: 'test/s2_03_symsearch.png' });
}
// close dialog
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(300);

// ── Log scale / autoscale toggle (#btnScale cycles Auto -> Log -> Percent) ──
const scaleBtn = page.locator('#btnScale');
results.scaleBtnCount = await scaleBtn.count();
if (await scaleBtn.count()) {
  results.scaleLabel0 = (await scaleBtn.textContent()).trim();
  await scaleBtn.click(); await page.waitForTimeout(400);
  results.scaleLabel1 = (await scaleBtn.textContent()).trim();
  await scaleBtn.click(); await page.waitForTimeout(400);
  results.scaleLabel2 = (await scaleBtn.textContent()).trim();
  // read actual chart priceScale mode via page eval
  results.priceScaleModeAfter2Clicks = await page.evaluate(() => {
    try { return chart.priceScale('right').options().mode; } catch (e) { return 'ERR:' + e.message; }
  });
  await scaleBtn.click(); await page.waitForTimeout(400); // back to auto
  results.scaleLabel3 = (await scaleBtn.textContent()).trim();
}
await page.screenshot({ path: 'test/s2_04_scale_cycled.png' });

// ── Session/timezone selector search ──
const tzSelectors = ['[title*="timezone" i]', '[title*="session" i]', '#tzSel', '#sessionSel', 'text=/UTC/i'];
let tzFound = 0;
for (const sel of tzSelectors) {
  tzFound += await page.locator(sel).count().catch(() => 0);
}
results.timezoneUiHitCount = tzFound;

// ── Extended/last price line ──
results.priceLineVisibleOnCandle = await page.evaluate(() => {
  try {
    // lightweight-charts doesn't expose series options for lastValueVisible directly by name easily;
    // but we can check the candle series options object.
    return candle.options().priceLineVisible;
  } catch (e) { return 'ERR:' + e.message; }
});

// ── Countdown to bar close ──
results.countdownTextFound = await page.evaluate(() => {
  const bodyText = document.body.innerText;
  return /\b\d{1,2}:\d{2}(:\d{2})?\b.*(close|bar)|closes in|bar close/i.test(bodyText);
});
// also scan price-axis area screenshot region text nodes near right edge
results.rightAxisSample = await page.evaluate(() => {
  const el = document.querySelector('#chart');
  return el ? el.getBoundingClientRect() : null;
});

// ── Historical data on scroll-back (infinite lazy load) ──
// Get current bar count via lastData if exposed, then scroll timeScale left and see if more requests fire / more bars appear.
const chartBox = await page.locator('#chart').boundingBox();
let scrollFetch = false;
const onReq2 = req => { if (/coinbase|candles|klines|proxy/i.test(req.url())) scrollFetch = true; };
page.on('request', onReq2);
if (chartBox) {
  // scroll left aggressively (TradingView pattern: mouse drag / wheel)
  await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2);
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(-300, 0); // shift-less horizontal wheel; lightweight-charts maps wheel to scroll/zoom
    await page.waitForTimeout(150);
  }
  // Also try explicit drag-based panning far to the right (which reveals older/left data in a right-anchored chart)
  await page.mouse.move(chartBox.x + 200, chartBox.y + chartBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(chartBox.x + chartBox.width - 100, chartBox.y + chartBox.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
}
page.off('request', onReq2);
results.scrollBackTriggeredFetch = scrollFetch;
await page.screenshot({ path: 'test/s2_05_after_scrollback.png' });

results.consoleErrors = consoleErrors.slice(0, 20);

console.log(JSON.stringify(results, null, 2));
await browser.close();
