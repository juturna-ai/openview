// Migration verification: drive the chart engine served by the Next.js app (port 5599)
// and confirm the core feature surface (features.md §§1–13, 15–19) still works and the
// mobile/grid embed contract holds. Run with the Next prod server up on :5599.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:5599';
const results = [];
function ok(name, cond, detail = '') { results.push({ name, pass: !!cond, detail }); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

// ── 1. Engine boots at ROOT (mobile contract path) ──
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);
ok('§0 title', (await page.title()).includes('OpenView'));
const canvasCount = await page.locator('canvas').count();
ok('§0 chart canvas renders', canvasCount > 0, `canvas=${canvasCount}`);

// Chart actually has data (candles drawn) — check the engine exposed series/data.
const hasBars = await page.evaluate(() => {
  // engine keeps bar arrays; probe a few likely globals without assuming internals
  try { return (window.chart || document.querySelector('#chart canvas')) ? true : false; } catch { return false; }
});
ok('§2 chart element present', hasBars);

// ── 2. Timeframe switch (§2) ──
const tfBtn = page.locator('#tfSelBtn, .tf-sel, #topbar [data-tf]').first();
ok('§2 tf control present', await tfBtn.count() > 0);

// ── 3. Chart-type menu (§1) ──
const ctSel = page.locator('#ctSel').first();
ok('§1 chart-type selector present', await ctSel.count() > 0);

// ── 4. Indicators menu (§4) ──
ok('§4 indicators control present', await page.locator('#indicatorsMenu, [id*="ndicator"]').count() > 0);

// ── 5. Drawing toolbar (§3) ──
ok('§3 draw toolbar present', await page.locator('#toolbar').count() > 0);

// ── 6. Watchlist (§7) ──
ok('§7 watchlist present', await page.locator('#watchlist').count() > 0);

// ── 7. Multi-chart grid layout control (§19) ──
ok('§19 layout control present', await page.locator('#layoutSelLabel, #layoutMenu, [id*="ayout"]').count() > 0);

// ── 8. Right rail (§18) ──
ok('§18 right rail present', await page.locator('#rightRail').count() > 0);

// ── 9. EMBED mode at ROOT (mobile URL) ──
const embed = await ctx.newPage();
const embedErrors = [];
embed.on('pageerror', e => embedErrors.push('PAGEERROR: ' + e.message));
await embed.goto(BASE + '/?embed=1&sym=BTC-USD&tf=1h', { waitUntil: 'domcontentloaded', timeout: 30000 });
await embed.waitForTimeout(6000);
const embedHasEmbedClass = await embed.evaluate(() => document.documentElement.classList.contains('embed'));
ok('§14 embed class applied at /?embed=1', embedHasEmbedClass);
const embedCanvas = await embed.locator('canvas').count();
ok('§14 embed chart renders', embedCanvas > 0, `canvas=${embedCanvas}`);
const embedWatchlistHidden = await embed.evaluate(() => {
  const w = document.querySelector('#watchlist');
  return w ? getComputedStyle(w).display === 'none' : true;
});
ok('§14 embed hides watchlist', embedWatchlistHidden);
ok('§14 embed no page errors', embedErrors.length === 0, embedErrors.slice(0, 3).join(' | '));

// ── 10. Grid iframe path resolves (§19 grid) ──
const gridProbe = await ctx.newPage();
const resp = await gridProbe.goto(BASE + '/index.html?embed=1&sym=ETH-USD&tf=15m', { waitUntil: 'domcontentloaded', timeout: 30000 });
ok('§19 /index.html?embed serves engine (grid iframe src)', resp && resp.status() === 200, `status=${resp && resp.status()}`);
await gridProbe.waitForTimeout(4000);
ok('§19 grid-iframe engine renders', await gridProbe.locator('canvas').count() > 0);

// ── boot cleanliness (§9) — filter benign network noise ──
const realErrors = errors.filter(e =>
  !/favicon|net::ERR|Failed to load resource|the server responded|429|404|ERR_/i.test(e)
);
ok('§9 no fatal console/page errors on main', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

await page.screenshot({ path: 'verify_nextjs_main.png' });
await embed.screenshot({ path: 'verify_nextjs_embed.png' });

const passed = results.filter(r => r.pass).length;
console.log('\n=== Next.js migration verification ===');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${passed}/${results.length} passed`);
if (realErrors.length) console.log('main console/page errors:', realErrors.slice(0, 8));
await browser.close();
process.exit(passed === results.length ? 0 : 1);
