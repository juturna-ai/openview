// Regression: the RSI pane fills TEAL between the RSI line and the 70 band when
// overbought (RSI > 70), and RED between the line and the 30 band when oversold
// (RSI < 30) — TradingView-style. Implemented as two baseline series (rsiOB anchored
// at 70 top-fill teal, rsiOS anchored at 30 bottom-fill red) fed the RSI values.
// NOTE: in lightweight-charts 4.1.3 a fully-transparent baseline edge line suppresses
// its fill, so the active edge line carries a faint tint of the fill color.
import { chromium } from 'playwright';
const URL = process.env.FV_URL || 'http://127.0.0.1:5501/index.html';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport:{ width:1400, height:900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil:'domcontentloaded', timeout:20000 });
await page.waitForTimeout(5000);

// Drive RSI hard overbought (first half) then hard oversold (second half) through the
// real render path so rsiOB/rsiOS are fed exactly as in production.
await page.evaluate(() => {
  const t0 = lastData[0].time, step = (lastData[1].time - lastData[0].time) || 86400;
  const bars = []; let price = 100;
  for (let i = 0; i < 300; i++) { price += i < 150 ? 3 : -3;
    bars.push({ time:t0+i*step, open:price-1, high:price+1, low:price-2, close:price, volume:100 }); }
  lastData = bars; renderData(bars, false);
});
await page.waitForTimeout(900);

const scan = await page.evaluate(() => {
  const cv = document.querySelector('#rsi canvas'); const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(cv.clientWidth), H = Math.round(cv.clientHeight);
  let teal = 0, red = 0;
  for (let xf = 0.05; xf < 0.95; xf += 0.02) { const x = Math.round(xf*W*dpr);
    for (let y = 2; y < H-2; y += 2) { const p = ctx.getImageData(x, Math.round(y*dpr), 1, 1).data;
      if (p[1] > 60 && p[2] > 60 && p[0] < p[1]-15) teal++;               // overbought teal fill
      if (p[0] > 60 && p[0] > p[1]+15 && p[0] > p[2]+15) red++; } }        // oversold red fill
  return { teal, red, hasOB: typeof rsiOB !== 'undefined', hasOS: typeof rsiOS !== 'undefined' };
});

// Hiding the RSI line hides the fills too.
const hidden = await page.evaluate(() => {
  RSI_PARAMS.style.rsi.on = false; applyRsiStyle();
  return { obVisible: rsiOB.options().visible, osVisible: rsiOS.options().visible };
});

const ok = scan.hasOB && scan.hasOS && scan.teal > 50 && scan.red > 50
  && hidden.obVisible === false && hidden.osVisible === false && errs.length === 0;
console.log(JSON.stringify({ scan, hidden, errs: errs.slice(0,3), ok }, null, 2));
await browser.close();
if (!ok) { console.error('FAIL: RSI overbought/oversold fills not rendering as expected'); process.exit(1); }
console.log('PASS');
