// Regression: the main-pane crosshair ⊕ must DISAPPEAR when the cursor leaves the price plot
// (e.g. moving down into the RSI/indicator pane). Bug: dcanvas mouseleave only redrew when a
// hover/alertHover was active, so with none set the ⊕ stayed painted ("glitched"). We can't read
// canvas pixels reliably, so assert the engine state: crossPlusHit must be null after leaving.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3333';
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const fails = [];
const check = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); if (!c) fails.push(n); };

await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(6000);

const chart = p.locator('#chart');
const cbox = await chart.boundingBox();
// Hover the middle of the main plot → ⊕ should arm (crossPlusHit set).
await p.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.5);
await p.waitForTimeout(200);
const armed = await p.evaluate(() => (typeof crossPlusHit !== 'undefined' && crossPlusHit) ? true : false);
check('⊕ armed while hovering main plot', armed);

// Now move OFF the plot: into the RSI pane below.
const rsi = p.locator('#rsi');
const rbox = await rsi.boundingBox();
await p.mouse.move(rbox.x + rbox.width * 0.5, rbox.y + rbox.height * 0.5);
await p.waitForTimeout(300);
const cleared = await p.evaluate(() => (typeof crossPlusHit === 'undefined' || crossPlusHit == null));
check('main-pane ⊕ cleared after leaving plot (into RSI pane)', cleared);

// And moving the mouse fully outside the chart area also clears it.
await p.mouse.move(5, 5);
await p.waitForTimeout(300);
const clearedOut = await p.evaluate(() => (typeof crossPlusHit === 'undefined' || crossPlusHit == null));
check('main-pane ⊕ cleared after leaving chart entirely', clearedOut);

console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES: ' + fails.join(', ')}`);
await b.close();
process.exit(fails.length === 0 ? 0 : 1);
