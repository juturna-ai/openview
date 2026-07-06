// Regression test for the "timeframe switch is slow / sometimes doesn't change"
// bug.
//
// Root cause: selectTF() → loadChart() → fetchKlinesProgressive() fetches up to
// ~168 sequential pages for a Coinbase intraday TF (50k bars ÷ 300/page). Every
// page called paint() → a FULL re-render (candles + 6 MAs + RSI) AND re-ran
// finalizeBars() over the whole accumulating array (dedup + sort + O(N·W)
// sanitize + aggregate). That is O(N²) main-thread work that grows per page,
// freezing the UI for ~20s and making rapid TF clicks appear to "not change".
//
// Fix: throttle the per-page repaint. First page paints instantly (snaps to the
// latest bar); later pages only repaint on a coalesced rAF at most every ~250ms,
// and always once at the very end. History still deepens in the background.
//
// This test measures wall-clock from clicking a new TF to the chart reflecting
// that TF's data. Fails on the pre-fix build (>6s), passes after (<3s).
// Run:  node test/regression_tf_switch.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });

let crashes = 0;
p.on('pageerror', e => { if (e.message === 'Value is null') crashes++; });

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

// Land on a single Coinbase symbol + a shallow TF, wait for it to settle.
await p.evaluate(() => { activeSymbol = 'BTC-USD'; loadChart('BTC-USD', '1d'); });
await p.waitForTimeout(6000);

// Switch to 1H (the worst case: 300-bar Coinbase pages, ~168 of them) and time
// how long until the chart's bar spacing reflects the new, denser TF.
const t0 = Date.now();
await p.evaluate(() => selectTF('1h'));

// "Changed" = activeTF updated AND at least one 1H page has painted into the
// series (lastData reflects hourly spacing: <= ~3600s between last two bars).
let changedMs = -1;
for (let i = 0; i < 120; i++) {          // up to 12s
  const ok = await p.evaluate(() => {
    if (activeTF !== '1h') return false;
    if (!Array.isArray(lastData) || lastData.length < 2) return false;
    const n = lastData.length;
    const step = lastData[n - 1].time - lastData[n - 2].time;
    return step <= 3600;                 // hourly (or tighter), not daily
  });
  if (ok) { changedMs = Date.now() - t0; break; }
  await p.waitForTimeout(100);
}

const t1 = changedMs >= 0 && changedMs < 3000;   // visible switch under 3s
const t2 = crashes === 0;

console.log(`TF switch → first 1H paint: ${changedMs}ms`);
console.log(`  [${t1 ? 'PASS' : 'FAIL'}] switch reflected in < 3000ms`);
console.log(`  [${t2 ? 'PASS' : 'FAIL'}] no LWC render crash (crashes=${crashes})`);

await b.close();
process.exit(t1 && t2 ? 0 : 1);
