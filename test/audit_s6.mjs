import { chromium } from 'playwright';
import fs from 'fs';

const OUT = '/home/morrison/projects/Freeview/Freeview/test/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', () => {});
  page.on('pageerror', () => {});
  await page.goto('http://127.0.0.1:5501/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return page;
}

console.log('=== SECTION 6 AUDIT ===\n');

// ── 1920x1080 pass ──
const page = await newPage(1920, 1080);
await page.screenshot({ path: OUT + '/s6_full_1920.png' });

// -- Top toolbar enumeration --
const topbar = await page.evaluate(() => {
  const tb = document.getElementById('topbar');
  const btns = Array.from(tb.querySelectorAll('button, .tf-sel, #symbolBox'));
  return btns.map(b => ({
    tag: b.tagName, id: b.id, cls: b.className,
    text: b.innerText?.trim().slice(0, 40), title: b.getAttribute('title')
  }));
});
console.log('TOPBAR CHILDREN:', JSON.stringify(topbar, null, 2));

const symbolBoxClickable = await page.evaluate(() => {
  const sb = document.getElementById('symbolBox');
  return sb ? { hasOnclick: !!sb.onclick, cursor: getComputedStyle(sb).cursor } : null;
});
console.log('SYMBOL BOX:', JSON.stringify(symbolBoxClickable));

// try clicking symbol box to see if search dialog opens
await page.click('#symbolBox').catch(()=>{});
await page.waitForTimeout(300);
const symDlgOpen = await page.evaluate(() => document.getElementById('symDlg')?.classList.contains('open'));
console.log('Symbol search dialog opens on click:', symDlgOpen);
await page.screenshot({ path: OUT + '/s6_symbol_search.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// -- Left toolbar enumeration (flyout check) --
const leftToolbar = await page.evaluate(() => {
  const tb = document.getElementById('toolbar');
  const tools = Array.from(tb.children).map(c => ({ cls: c.className, tool: c.dataset?.tool, title: c.title }));
  // check for any nested submenu containers
  const hasNestedMenus = !!tb.querySelector('.flyout, .submenu, .sub-menu, .toolgroup, [class*="fly"]');
  return { count: tools.length, tools, hasNestedMenus };
});
console.log('LEFT TOOLBAR:', JSON.stringify(leftToolbar, null, 2));
await page.locator('#toolbar').screenshot({ path: OUT + '/s6_left_toolbar.png' }).catch(()=>{});

// try right-click / long-press on a tool icon to see if a flyout appears
const firstTool = page.locator('#toolbar .tool').first();
await firstTool.click({ button: 'right' }).catch(()=>{});
await page.waitForTimeout(200);

// -- Right sidebar tabs enumeration --
const rightSidebar = await page.evaluate(() => {
  const wl = document.getElementById('watchlist');
  const head = wl?.querySelector('#wlHead')?.innerText;
  // look for any tab-like siblings
  const possibleTabs = Array.from(document.querySelectorAll('[class*="tab"], [id*="tab"]')).map(e => ({ id: e.id, cls: e.className, text: e.innerText?.trim().slice(0,30) }));
  return { watchlistHeader: head, possibleTabs };
});
console.log('RIGHT SIDEBAR:', JSON.stringify(rightSidebar, null, 2));
await page.locator('#watchlist').screenshot({ path: OUT + '/s6_right_sidebar.png' }).catch(()=>{});

// -- Bottom bar check --
const bottomBar = await page.evaluate(() => {
  const app = document.getElementById('app');
  const rect = app.getBoundingClientRect();
  // find elements near the bottom of viewport
  const all = Array.from(document.querySelectorAll('body > *, #app > *'));
  const bottomEls = all.filter(e => {
    const r = e.getBoundingClientRect();
    return r.bottom >= window.innerHeight - 40 && r.height > 0 && r.height < 100;
  }).map(e => ({ id: e.id, cls: e.className }));
  return { bottomEls, appBottom: rect.bottom, winHeight: window.innerHeight };
});
console.log('BOTTOM BAR CANDIDATES:', JSON.stringify(bottomBar, null, 2));

// -- Legend screenshot (top-left of chart) --
const chartBox = await page.locator('#chartWrap').boundingBox();
if (chartBox) {
  await page.screenshot({
    path: OUT + '/s6_legend_topleft.png',
    clip: { x: chartBox.x, y: chartBox.y, width: Math.min(500, chartBox.width), height: 150 }
  });
}
const legendContent = await page.evaluate(() => {
  const ohlc = document.getElementById('ohlc')?.innerText;
  const maLegend = document.getElementById('maLegend')?.innerText;
  const indLegend = document.getElementById('indLegend')?.innerText;
  // is there a change% anywhere near OHLC?
  const hasChangePct = /%/.test(ohlc || '') ;
  return { ohlc, maLegend, indLegend, hasChangePctInOhlc: hasChangePct };
});
console.log('LEGEND CONTENT:', JSON.stringify(legendContent, null, 2));

// -- Crosshair with axis labels --
if (chartBox) {
  await page.mouse.move(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.4);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/s6_crosshair.png' });
}
const axisLabels = await page.evaluate(() => {
  // lightweight-charts renders axis labels onto its own canvas, so we can't grab DOM text directly.
  // Check for tooltip/crosshair-label DOM elements that some builds add.
  const candidates = Array.from(document.querySelectorAll('[class*="crosshair"], [class*="axis-label"], [class*="tv-"]'));
  return candidates.map(e => ({ cls: e.className, text: e.innerText?.slice(0,30) }));
});
console.log('AXIS LABEL DOM CANDIDATES (lib renders on canvas, expect empty):', JSON.stringify(axisLabels));

// -- Dark theme colors: computed styles + CSS vars --
const colors = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const chartEl = document.getElementById('chart');
  const chartBg = chartEl ? getComputedStyle(chartEl).backgroundColor : null;
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const appBg = getComputedStyle(document.getElementById('app')).backgroundColor;
  return {
    cssVars: {
      '--bg': root.getPropertyValue('--bg').trim(),
      '--panel': root.getPropertyValue('--panel').trim(),
      '--panel2': root.getPropertyValue('--panel2').trim(),
      '--border': root.getPropertyValue('--border').trim(),
      '--text': root.getPropertyValue('--text').trim(),
      '--muted': root.getPropertyValue('--muted').trim(),
      '--green': root.getPropertyValue('--green').trim(),
      '--red': root.getPropertyValue('--red').trim(),
    },
    computedChartBg: chartBg,
    computedBodyBg: bodyBg,
    computedAppBg: appBg,
  };
});
console.log('COLORS:', JSON.stringify(colors, null, 2));

// -- Light theme toggle search --
const themeToggle = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button, .tbtn, [id*="theme"], [class*="theme"]'));
  return candidates.filter(e => /theme|light|dark/i.test(e.id + ' ' + e.className + ' ' + (e.title||''))).map(e => ({ id: e.id, cls: e.className, title: e.title }));
});
console.log('THEME TOGGLE CANDIDATES:', JSON.stringify(themeToggle));

// -- Multi-chart layout grid select --
const multiChartUI = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button, [id*="grid"], [id*="layout"], [class*="layout"], [id*="split"]'));
  return candidates.filter(e => /grid|layout|split|multi/i.test(e.id + ' ' + e.className + ' ' + (e.title||''))).map(e => ({ id: e.id, cls: e.className, title: e.title }));
});
console.log('MULTI-CHART / LAYOUT UI CANDIDATES:', JSON.stringify(multiChartUI));

// -- Fullscreen button search --
const fullscreenUI = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button, [id*="full"], [class*="full"]'));
  return candidates.filter(e => /full/i.test(e.id + ' ' + e.className + ' ' + (e.title||''))).map(e => ({ id: e.id, title: e.title }));
});
console.log('FULLSCREEN UI CANDIDATES:', JSON.stringify(fullscreenUI));
console.log('document.fullscreenEnabled used anywhere:', await page.evaluate(() => typeof document.exitFullscreen));

// -- Export / screenshot button search --
const exportUI = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button, [id*="export"], [id*="screenshot"], [id*="save-image"]'));
  return candidates.filter(e => /export|screenshot|download|camera/i.test(e.id + ' ' + e.className + ' ' + (e.title||''))).map(e => ({ id: e.id, title: e.title }));
});
console.log('EXPORT/SCREENSHOT UI CANDIDATES:', JSON.stringify(exportUI));

// -- Keyboard shortcuts test: arrow keys pan, +/- zoom, Alt+H --
await page.mouse.move(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.5);
const beforeShapes = await page.evaluate(() => (typeof draw !== 'undefined' ? draw.shapes.length : null));
const beforeScroll = await page.evaluate(() => { try { return chart.timeScale().scrollPosition(); } catch(e) { return null; } });
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(150);
const afterArrowScroll = await page.evaluate(() => { try { return chart.timeScale().scrollPosition(); } catch(e) { return null; } });
await page.keyboard.press('Equal'); // '+' key
await page.waitForTimeout(150);
const afterPlusVisibleRange = await page.evaluate(() => { try { return chart.timeScale().getVisibleLogicalRange(); } catch(e) { return null; } });
await page.keyboard.down('Alt');
await page.keyboard.press('KeyH');
await page.keyboard.up('Alt');
await page.waitForTimeout(150);
const afterAltHShapes = await page.evaluate(() => (typeof draw !== 'undefined' ? draw.shapes.length : null));
console.log('KEYBOARD SHORTCUT TEST:', JSON.stringify({
  beforeScroll, afterArrowScroll, arrowChanged: beforeScroll !== afterArrowScroll,
  afterPlusVisibleRange,
  beforeShapes, afterAltHShapes, altHAddedShape: afterAltHShapes > beforeShapes
}));

// -- Right-click context menu on chart --
await page.mouse.click(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.5, { button: 'right' });
await page.waitForTimeout(300);
const ctxMenuState = await page.evaluate(() => {
  const el = document.getElementById('ctxMenu');
  return el ? { display: getComputedStyle(el).display, itemCount: el.children.length, sampleItems: Array.from(el.children).slice(0,6).map(c=>c.textContent.trim()) } : null;
});
console.log('CONTEXT MENU STATE:', JSON.stringify(ctxMenuState, null, 2));
await page.screenshot({ path: OUT + '/s6_context_menu.png' });
await page.mouse.click(50, 50); // dismiss
await page.waitForTimeout(200);

await page.close();

// ── 1366x768 pass for responsiveness ──
const page2 = await newPage(1366, 768);
await page2.screenshot({ path: OUT + '/s6_full_1366.png' });
const layoutCheck1366 = await page2.evaluate(() => {
  const wl = document.getElementById('watchlist');
  const tb = document.getElementById('toolbar');
  const chart = document.getElementById('chart');
  return {
    watchlistVisible: wl ? getComputedStyle(wl).display !== 'none' && wl.getBoundingClientRect().width > 0 : false,
    watchlistWidth: wl?.getBoundingClientRect().width,
    toolbarVisible: tb ? tb.getBoundingClientRect().width > 0 : false,
    chartWidth: chart?.getBoundingClientRect().width,
    chartHeight: chart?.getBoundingClientRect().height,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    bodyScrollWidth: document.documentElement.scrollWidth,
    winWidth: window.innerWidth,
  };
});
console.log('1366x768 LAYOUT CHECK:', JSON.stringify(layoutCheck1366, null, 2));
await page2.close();

console.log('\n=== DONE ===');
await browser.close();
