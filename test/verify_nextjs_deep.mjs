// Deep parity check between ORIGINAL (python-served) and NEXTJS-served chart engine.
// Drives both servers through the same interactive feature checks and reports differences.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGETS = [
  { name: 'ORIGINAL', url: 'http://127.0.0.1:5501/', screenshot: path.join(__dirname, 'deep_orig.png') },
  { name: 'NEXTJS', url: 'http://127.0.0.1:5599/', screenshot: path.join(__dirname, 'deep_next.png') },
];

const NOISE_PATTERNS = [
  /favicon/i,
  /net::ERR/i,
  /404/,
  /429/,
  /Failed to load resource/i,
];

function isNoise(text) {
  return NOISE_PATTERNS.some((re) => re.test(text));
}

async function run(target) {
  const result = { name: target.name, url: target.url };
  const consoleErrors = [];
  const pageErrors = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isNoise(text)) consoleErrors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    if (!isNoise(text)) pageErrors.push(text);
  });
  page.on('requestfailed', () => {
    // network noise; ignored deliberately (filtered separately from console/page errors)
  });

  await page.goto(target.url, { waitUntil: 'load' });
  await page.waitForTimeout(6000);

  // ---- §1 Chart types ----
  try {
    await page.click('#ctSel');
    await page.waitForTimeout(300);
    result.chartTypeCount = await page.evaluate(() => document.querySelectorAll('#ctMenu .tf-opt[data-ct]').length);
    // close menu
    await page.keyboard.press('Escape').catch(() => {});
    await page.click('#ctSel').catch(() => {});
    await page.waitForTimeout(200);
  } catch (e) {
    result.chartTypeCount = -1;
    result.chartTypeError = e.message;
  }

  // ---- §2 Timeframe ----
  try {
    await page.click('#tfSelBtn');
    await page.waitForTimeout(300);
    result.timeframeCount = await page.evaluate(() => document.querySelectorAll('#tfMenu .tf-opt[data-i]').length);
    await page.keyboard.press('Escape').catch(() => {});
    await page.click('#tfSelBtn').catch(() => {});
    await page.waitForTimeout(200);
  } catch (e) {
    result.timeframeCount = -1;
    result.timeframeError = e.message;
  }

  // ---- §4 Indicators ----
  try {
    await page.click('#btnIndicators');
    await page.waitForTimeout(400);
    const indInfo = await page.evaluate(() => {
      const m = document.querySelector('#indicatorsMenu');
      const visible = m ? (m.offsetParent !== null && getComputedStyle(m).display !== 'none') : false;
      const entries = m ? m.querySelectorAll('#indList .pi').length : 0;
      const categories = m ? m.querySelectorAll('#indList .indcat').length : 0;
      return { visible, entries, categories };
    });
    result.indicatorsMenuVisible = indInfo.visible;
    result.indicatorCatalogCount = indInfo.entries;
    result.indicatorCategoryCount = indInfo.categories;
    // close
    const closeBtn = await page.$('#indClose');
    if (closeBtn) await closeBtn.click().catch(() => {});
    await page.waitForTimeout(200);
  } catch (e) {
    result.indicatorsMenuVisible = false;
    result.indicatorCatalogCount = -1;
    result.indicatorError = e.message;
  }

  // ---- §3 Drawing tools ----
  try {
    result.toolbarButtonCount = await page.evaluate(() => document.querySelectorAll('#toolbar .tool').length);
  } catch (e) {
    result.toolbarButtonCount = -1;
    result.toolbarError = e.message;
  }

  // ---- §7 Watchlist ----
  try {
    result.watchlistRowCount = await page.evaluate(() => document.querySelectorAll('#watchlist .row[data-sym]').length);
  } catch (e) {
    result.watchlistRowCount = -1;
    result.watchlistError = e.message;
  }

  // ---- §5 Alerts ----
  try {
    result.hasAlertFeature = await page.evaluate(() => {
      return typeof window.openAlertDialog !== 'undefined' || !!document.querySelector('#btnAlert');
    });
  } catch (e) {
    result.hasAlertFeature = false;
    result.alertError = e.message;
  }

  // ---- §11/§12 Indicator catalog & script feature ----
  try {
    result.hasScriptButton = await page.evaluate(() => !!document.querySelector('#btnScript'));
  } catch (e) {
    result.hasScriptButton = false;
  }

  // ---- §19 Multi-chart grid / layout ----
  try {
    await page.click('#layoutSelLabel');
    await page.waitForTimeout(300);
    result.layoutVariantCount = await page.evaluate(() => document.querySelectorAll('#layoutMenu .lp-item[data-layout]').length);

    const has2h = await page.$('#layoutMenu .lp-item[data-layout="2h"]');
    if (has2h) {
      await has2h.click();
      await page.waitForTimeout(1500);
      const gridInfo = await page.evaluate(() => {
        const g = document.querySelector('#chartGrid');
        return { exists: !!g, iframes: g ? g.querySelectorAll('iframe').length : 0 };
      });
      result.chartGridExists = gridInfo.exists;
      result.chartGridIframeCount = gridInfo.iframes;

      // revert back to 1-chart layout to leave page in clean state
      await page.click('#layoutSelLabel').catch(() => {});
      await page.waitForTimeout(300);
      const has1 = await page.$('#layoutMenu .lp-item[data-layout="1"]');
      if (has1) {
        await has1.click();
        await page.waitForTimeout(800);
      }
    } else {
      result.chartGridExists = false;
      result.chartGridIframeCount = 0;
    }
  } catch (e) {
    result.layoutVariantCount = -1;
    result.chartGridExists = false;
    result.chartGridIframeCount = -1;
    result.layoutError = e.message;
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: target.screenshot, fullPage: false });

  result.consoleErrorCount = consoleErrors.length;
  result.pageErrorCount = pageErrors.length;
  result.consoleErrors = consoleErrors.slice(0, 10);
  result.pageErrors = pageErrors.slice(0, 10);

  await browser.close();
  return result;
}

function fmt(v) {
  if (v === undefined) return 'n/a';
  return String(v);
}

async function main() {
  const results = [];
  for (const target of TARGETS) {
    console.log(`Running checks against ${target.name} (${target.url}) ...`);
    const r = await run(target);
    results.push(r);
    console.log(`  done: ${target.name}`);
  }

  const [orig, next] = results;

  const metrics = [
    ['§1 Chart type options', 'chartTypeCount', 'exact'],
    ['§2 Timeframe options', 'timeframeCount', 'exact'],
    ['§4 Indicators menu visible', 'indicatorsMenuVisible', 'exact'],
    ['§4 Indicator catalog entries', 'indicatorCatalogCount', 'exact'],
    ['§4 Indicator categories', 'indicatorCategoryCount', 'exact'],
    ['§3 Toolbar tool buttons', 'toolbarButtonCount', 'exact'],
    ['§7 Watchlist rows', 'watchlistRowCount', 'jitter'],
    ['§5 Alert feature present', 'hasAlertFeature', 'exact'],
    ['§12 Script/Pine button present', 'hasScriptButton', 'exact'],
    ['§19 Layout variant options', 'layoutVariantCount', 'exact'],
    ['§19 Chart grid exists (2-chart)', 'chartGridExists', 'exact'],
    ['§19 Chart grid iframe count', 'chartGridIframeCount', 'exact'],
    ['Console/page errors (real)', 'realErrorCount', 'exact'],
  ];

  orig.realErrorCount = orig.consoleErrorCount + orig.pageErrorCount;
  next.realErrorCount = next.consoleErrorCount + next.pageErrorCount;

  const mismatches = [];
  const JITTER_ALLOWANCE = 2; // small remote-data jitter allowance for watchlist row counts etc.

  console.log('\n=== PARITY COMPARISON: ORIGINAL vs NEXTJS ===\n');
  const rows = metrics.map(([label, key, mode]) => {
    const a = orig[key];
    const b = next[key];
    let match;
    if (mode === 'jitter' && typeof a === 'number' && typeof b === 'number') {
      match = Math.abs(a - b) <= JITTER_ALLOWANCE;
    } else {
      match = a === b;
    }
    if (!match) mismatches.push(`${label} (orig=${fmt(a)}, next=${fmt(b)})`);
    return { label, a: fmt(a), b: fmt(b), match };
  });

  const labelWidth = Math.max(...rows.map((r) => r.label.length), 'METRIC'.length) + 2;
  const colWidth = 12;
  const pad = (s, w) => String(s).padEnd(w);

  console.log(pad('METRIC', labelWidth) + pad('ORIGINAL', colWidth) + pad('NEXTJS', colWidth) + 'MATCH');
  console.log('-'.repeat(labelWidth + colWidth * 2 + 6));
  for (const r of rows) {
    console.log(pad(r.label, labelWidth) + pad(r.a, colWidth) + pad(r.b, colWidth) + (r.match ? 'OK' : 'DIFF'));
  }

  console.log('\n--- Error details ---');
  for (const r of results) {
    console.log(`${r.name}: consoleErrors=${r.consoleErrorCount}, pageErrors=${r.pageErrorCount}`);
    if (r.consoleErrors.length) console.log('  console:', r.consoleErrors);
    if (r.pageErrors.length) console.log('  page:', r.pageErrors);
  }

  console.log(`\nScreenshots saved: ${TARGETS[0].screenshot}, ${TARGETS[1].screenshot}`);

  console.log('');
  if (mismatches.length === 0) {
    console.log('PARITY OK');
  } else {
    console.log(`PARITY MISMATCH: ${mismatches.join('; ')}`);
  }
}

main().catch((e) => {
  console.error('FATAL ERROR', e);
  process.exit(1);
});
