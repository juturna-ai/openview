import { chromium } from 'playwright';

const url = 'http://127.0.0.1:5501/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(4000); // let initial full history load settle

const before = await page.evaluate(() => ({
  len: (typeof lastData !== 'undefined' && lastData) ? lastData.length : null,
  earliest: (typeof lastData !== 'undefined' && lastData && lastData.length) ? lastData[0].time : null,
  latest: (typeof lastData !== 'undefined' && lastData && lastData.length) ? lastData[lastData.length - 1].time : null,
}));

const netLog = [];
page.on('request', req => {
  if (/coinbase|candles|klines|proxy/i.test(req.url())) netLog.push(req.url());
});

const chartBox = await page.locator('#chart').boundingBox();
// Pan far left repeatedly using lightweight-charts scroll (drag chart content to the right,
// which reveals earlier/left-side history - the TradingView-style "scroll back").
await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height / 2);
for (let i = 0; i < 8; i++) {
  await page.mouse.down();
  await page.mouse.move(chartBox.x + chartBox.width - 50, chartBox.y + chartBox.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(2500);

const after = await page.evaluate(() => ({
  len: (typeof lastData !== 'undefined' && lastData) ? lastData.length : null,
  earliest: (typeof lastData !== 'undefined' && lastData && lastData.length) ? lastData[0].time : null,
  latest: (typeof lastData !== 'undefined' && lastData && lastData.length) ? lastData[lastData.length - 1].time : null,
}));

console.log(JSON.stringify({ before, after, netCallsDuringScroll: netLog.length, sampleNetCalls: netLog.slice(0, 5) }, null, 2));
await browser.close();
