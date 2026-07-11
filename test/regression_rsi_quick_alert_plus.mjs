// Regression: the crosshair ⊕ quick-add-alert button must appear when hovering the RSI pane
// (mirrors the main price pane's ⊕) and, when clicked, add a source:"rsi" alert with a native
// RSI price line. Before the fix there is no #rsiCrossPlus and hovering the RSI pane offers no
// one-tap alert. Run against the Next server (port 5599) or the raw engine.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:5599';
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const fails = [];
function check(name, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails.push(name); }

await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(6000);

// RSI pane exists
const rsi = p.locator('#rsi');
check('RSI pane present', await rsi.count() > 0);

// Hover the middle of the RSI pane (not the right axis gutter)
const box = await rsi.boundingBox();
await p.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
await p.waitForTimeout(300);

// ⊕ button should be visible on hover
const plusVisible = await p.evaluate(() => {
  const el = document.getElementById('rsiCrossPlus');
  return el ? getComputedStyle(el).display !== 'none' : false;
});
check('⊕ button visible when hovering RSI pane', plusVisible);

// Click it → a source:"rsi" alert is added with a native price line
const before = await p.evaluate(() => (window.alerts ? window.alerts.length : (typeof alerts !== 'undefined' ? alerts.length : -1)));
if (plusVisible) {
  await p.locator('#rsiCrossPlus').click();
  await p.waitForTimeout(400);
}
const after = await p.evaluate(() => {
  const arr = (typeof alerts !== 'undefined') ? alerts : [];
  const last = arr[arr.length - 1] || {};
  return { count: arr.length, lastSource: last.source, lines: (typeof rsiAlertLines !== 'undefined') ? rsiAlertLines.length : -1 };
});
check('clicking ⊕ added exactly one alert', after.count === before + 1);
check('added alert has source "rsi"', after.lastSource === 'rsi');
check('an RSI native price line exists', after.lines > 0);

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES: ' + fails.join(', ')}`);
await b.close();
process.exit(fails.length === 0 ? 0 : 1);
