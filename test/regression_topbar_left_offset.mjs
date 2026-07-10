// Regression: #topbar (and #chartGrid) are position:absolute INSIDE #main, which
// already sits to the right of the 52px drawing toolbar. A left:52px on them applies
// the toolbar offset twice, leaving 52px of dead space before the symbol box.
// Expectation: topbar content starts flush where #main starts (x = toolbar width).
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto('file://' + root + '/index.html');
await page.waitForSelector('#topbar');
await page.waitForTimeout(1500);

const m = await page.evaluate(() => {
  const tb = document.getElementById('toolbar').getBoundingClientRect();
  const top = document.getElementById('topbar').getBoundingClientRect();
  // switch to 2-chart grid so #chartGrid lays out
  document.getElementById('layoutSel'); // exists
  return { toolbarRight: Math.round(tb.right), topbarLeft: Math.round(top.left) };
});

let fails = [];
if (m.topbarLeft !== m.toolbarRight)
  fails.push(`topbar starts at x=${m.topbarLeft}, expected flush with toolbar edge x=${m.toolbarRight}`);

// grid: force grid-on so #chartGrid lays out, then measure
const g = await page.evaluate(() => {
  document.documentElement.classList.add('grid-on');
  const tb = document.getElementById('toolbar').getBoundingClientRect();
  const grid = document.getElementById('chartGrid').getBoundingClientRect();
  document.documentElement.classList.remove('grid-on');
  return { toolbarRight: Math.round(tb.right), gridLeft: Math.round(grid.left) };
});
if (g.gridLeft !== g.toolbarRight)
  fails.push(`chartGrid starts at x=${g.gridLeft}, expected flush with toolbar edge x=${g.toolbarRight}`);

await browser.close();
if (fails.length) { console.error('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS: topbar and chartGrid flush with drawing toolbar');
