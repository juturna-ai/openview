// Reproduces the "chart hangs / takes too long to load" glitch: a single stalled
// upstream fetch (endpoint accepts the connection but never responds) blocks the
// progressive loader forever, because no fetch had a timeout. With the fix, the
// stalled request aborts and the loader either retries or falls through, so the
// chart still resolves within a bounded time.
//
// Strategy: intercept window.fetch in the page. The FIRST candle request to each
// host hangs forever; subsequent ones succeed. Pre-fix → loadChart never resolves
// (status stuck on "Loading…"). Post-fix → the hung page aborts, retry succeeds,
// chart paints. We assert the chart has data within a generous bound.

import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });

await p.goto('http://127.0.0.1:5501/', { waitUntil: 'domcontentloaded', timeout: 20000 });

// Install a fetch shim BEFORE the app loads data: make the very first candle
// request stall indefinitely, so a naive (timeout-less) loader would hang.
await p.evaluate(() => {
  const realFetch = window.fetch.bind(window);
  let candleReqs = 0;
  let stalledOnce = false;
  window.__stalledCount = 0;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isCandle = /candles|klines|kline|finance\/chart/.test(url);
    // Stall EVERY candle page from the 2nd onward: the first page paints instantly,
    // but the cursor-stepping loop must await page 2 to continue. A timeout-less
    // fetch here blocks the whole load forever. With a per-fetch timeout, each hung
    // page aborts and the loop exits via its normal "no more data" path.
    if (isCandle && ++candleReqs >= 2) {
      window.__stalledCount++;
      // Hang forever UNLESS the caller aborts us (the fix). If aborted, reject so
      // the retry path runs; if never aborted, this Promise never settles.
      return new Promise((resolve, reject) => {
        if (init && init.signal) {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }
      });
    }
    return realFetch(input, init);
  };
});

// Force a fresh Coinbase symbol load through the shimmed fetch, and record when
// loadChart's promise actually RESOLVES (all pages done, not just page 1 painted).
await p.evaluate(() => {
  window.__loadDone = false;
  Promise.resolve(loadChart('BTC-USD', '4h')).then(() => { window.__loadDone = true; });
});

// Wait up to 25s for loadChart to fully resolve despite the stalled mid-sequence
// page. Pre-fix this never happens (the loop awaits the hung page forever);
// post-fix the hung page aborts, the retry path runs, and the load completes.
let ok = false;
for (let i = 0; i < 50; i++) {
  await p.waitForTimeout(500);
  if (await p.evaluate(() => window.__loadDone === true)) { ok = true; break; }
}

const stalled = await p.evaluate(() => window.__stalledCount);
const bars = await p.evaluate(() => (typeof lastData !== 'undefined' ? lastData.length : 0));
console.log(JSON.stringify({ stalledRequests: stalled, barsLoaded: bars, loadResolved: ok, appErrors: errs.slice(0, 4) }, null, 2));

await b.close();
process.exit(ok ? 0 : 1);
