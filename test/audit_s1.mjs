import { chromium } from 'playwright';
import fs from 'fs';

const url = 'http://127.0.0.1:5501/';
const outDir = '/home/morrison/projects/Freeview/Freeview/test/audit_s1_shots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);

// Open the chart-type dropdown and enumerate options
await page.click('#ctSelBtn');
await page.waitForTimeout(300);
const opts = await page.locator('#ctMenu .tf-opt').evaluateAll(els =>
  els.map(el => ({ text: el.textContent.trim(), ct: el.getAttribute('data-ct') }))
);
console.log('MENU OPTIONS:', JSON.stringify(opts, null, 2));

// close menu
await page.keyboard.press('Escape').catch(()=>{});
await page.click('body', { position: { x: 5, y: 5 } }).catch(()=>{});
await page.waitForTimeout(200);

const results = [];
for (const opt of opts) {
  const before = consoleErrors.length;
  await page.click('#ctSelBtn');
  await page.waitForTimeout(300);
  await page.click(`#ctMenu .tf-opt[data-ct="${opt.ct}"]`);
  await page.waitForTimeout(1500);
  const shotPath = `${outDir}/${opt.ct}.png`;
  await page.screenshot({ path: shotPath });
  const after = consoleErrors.length;
  const newErrors = consoleErrors.slice(before, after);
  const label = await page.locator('#ctSelLabel').textContent();
  results.push({ ct: opt.ct, label: opt.text, selectedLabel: label.trim(), screenshot: shotPath, newErrors });
}

fs.writeFileSync('/home/morrison/projects/Freeview/Freeview/test/audit_s1_results.json', JSON.stringify({ opts, results }, null, 2));
console.log('RESULTS:', JSON.stringify(results, null, 2));

await browser.close();
