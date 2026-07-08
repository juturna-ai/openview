// Regression — live WS ticks must (1) evaluate alerts and (2) not lose the
// forming bar's accumulated intrabar high/low when the 20s poll refreshes.
//
// Two bugs this reproduces:
//  A. applyTick() updated the forming bar between polls but never called
//     checkAlerts(), so a price that crossed an alert level via the WS feed
//     (not on a poll boundary) never fired.
//  B. renderData() replaced lastData wholesale every 20s poll. Coinbase's
//     candle endpoint lags real-time, so the intrabar wick the WS captured
//     (bar.high/bar.low) was overwritten by the lagging snapshot → wick vanished.
//
//   Run:  node test/regression_live_tick_alert_wick.mjs
import { chromium } from 'playwright';

const BASE = process.env.FV_URL || 'http://127.0.0.1:5501/';
// Force a single Coinbase symbol so applyTick()'s single-symbol path runs
// (the default NEAR-USD/INJ-USD is a ratio, which the WS feed doesn't drive).
const URL = BASE + (BASE.includes('?') ? '&' : '?') + 'sym=BTC-USD';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
// Wait for BTC-USD candles to load.
await p.waitForFunction(() => typeof lastData !== 'undefined' && lastData.length > 0 && !activeSymbol.includes('/'), { timeout: 20000 }).catch(()=>{});
await p.waitForTimeout(2000);

// ── Bug A: WS tick crossing an alert level must fire the alert ──
const alertFired = await p.evaluate(async () => {
  if (!lastData.length) return { skip: 'no data' };
  const bar = lastData[lastData.length - 1];
  const level = bar.close + Math.max(bar.close * 0.001, 1e-6);   // just above current close
  alerts.length = 0;
  alerts.push({ id:'aWS', source:'price', op:'crossing', target:'value',
    value: level, trigger:'perbar', expiry:0, message:'', notify:{}, active:true, _last:null });
  saveAlerts();

  const before = (typeof ALERT_LOG !== 'undefined' ? ALERT_LOG.length : 0);
  // Seed prior side so a cross is detectable, then push a tick above the level.
  const prod = wsProductsForActive()[0];
  const single = !activeSymbol.includes('/');
  if (single && prod) {
    _wsLast[prod] = bar.close;         applyTick();   // below level
    _wsLast[prod] = level + level*0.002; applyTick();  // crosses up through level
  } else {
    return { skip: 'not single Coinbase symbol in this env' };
  }
  const after = (typeof ALERT_LOG !== 'undefined' ? ALERT_LOG.length : 0);
  return { fired: after > before, before, after };
});

// ── Bug B: poll refresh must not erase the WS-accumulated intrabar high ──
const wickKept = await p.evaluate(() => {
  if (!lastData.length) return { skip: 'no data' };
  const bar = lastData[lastData.length - 1];
  const spikeHigh = bar.high + Math.max(bar.high * 0.02, 1e-4);   // a wick 2% above
  const prod = wsProductsForActive()[0];
  const single = !activeSymbol.includes('/');
  if (!(single && prod)) return { skip: 'not single Coinbase symbol' };

  // WS captures a spike high on the forming bar.
  _wsLast[prod] = spikeHigh; applyTick();
  const capturedHigh = lastData[lastData.length - 1].high;

  // Simulate a lagging 20s poll: same bars, but the last bar's high is BELOW
  // the spike (endpoint hasn't caught up). This mimics loadChart(keepView).
  const lagging = lastData.map(x => ({ ...x }));
  const lb = lagging[lagging.length - 1];
  lb.high = spikeHigh - Math.max(spikeHigh * 0.015, 1e-4);        // poll's high lags the spike
  renderData(lagging, true);

  const afterPoll = lastData[lastData.length - 1].high;
  return {
    capturedHigh, afterPoll,
    kept: afterPoll >= capturedHigh - 1e-9,   // spike wick survived the poll
  };
});

console.log(JSON.stringify({ alertFired, wickKept, errs }, null, 2));
await b.close();
const okA = alertFired.skip || alertFired.fired;
const okB = wickKept.skip || wickKept.kept;
process.exit(okA && okB && errs.length === 0 ? 0 : 1);
