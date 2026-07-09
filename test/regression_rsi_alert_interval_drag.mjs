// Feature test — RSI alerts: per-alert interval + drag-to-move the RSI-pane line.
//
// Requests:
//  1. Alert dialog has an Interval select (Same as chart + TF keys) for indicator
//     sources, hidden for price alerts; chosen interval persists on the alert.
//  2. Evaluation uses the alert's interval: RSI computed from that TF's candles
//     (fetched via fetchTfBars, cached), not the visible chart's lastData.
//  3. The dashed RSI-pane alert line can be grabbed (±6px) and dragged to a new
//     value; mouseup persists via saveAlerts.
//   Run:  node test/regression_rsi_alert_interval_drag.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — dialog: #ad_interval exists, defaults to "same as chart" (empty value),
// lists TF keys, and hides for source=price.
const t1 = await p.evaluate(() => {
  alerts.length = 0; saveAlerts();
  openAlertDialog({ source: 'rsi' });
  const sel = document.getElementById('ad_interval');
  if (!sel) { closeAlertDlg(); return false; }
  const row = document.getElementById('ad_interval_row');
  const hasTfs = ['1m','1h','1d'].every(k => [...sel.options].some(o => o.value === k));
  const defEmpty = sel.value === '';
  const visForRsi = row && row.style.display !== 'none';
  document.getElementById('ad_source').value = 'price';
  document.getElementById('ad_source').onchange();
  const hiddenForPrice = row.style.display === 'none';
  closeAlertDlg();
  return hasTfs && defEmpty && visForRsi && hiddenForPrice;
});

// t2 — create RSI alert with interval '1h' while chart is on another TF;
// interval persists to localStorage and into the alertsChanged payload shape.
const t2 = await p.evaluate(() => {
  openAlertDialog({ source: 'rsi' });
  const $ = id => document.getElementById(id);
  $('ad_op').value = 'crossing'; $('ad_target').value = 'value'; $('ad_value').value = '55';
  $('ad_interval').value = '1h';
  $('adOk').click();
  const a = alerts.find(z => z.source === 'rsi');
  const saved = JSON.parse(localStorage.getItem(alertsKey()) || '[]').find(z => z.source === 'rsi');
  return !!a && a.interval === '1h' && !!saved && saved.interval === '1h';
});

// t3 — evaluation is interval-aware: after the 1h bars land in the cache, the
// alert's LHS equals RSI computed from those 1h bars (not from lastData when
// the chart TF differs).
const t3 = await p.evaluate(async () => {
  if (typeof alertSourceValue !== 'function') return false;
  const a = alerts.find(z => z.source === 'rsi');
  alertSourceValue(a, a.source);                    // kicks the fetch
  const t0 = Date.now();
  let v = null;
  while (Date.now() - t0 < 15000) {
    v = alertSourceValue(a, a.source);
    if (v != null) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (v == null || !isFinite(v)) return false;
  const bars = await fetchTfBars(activeSymbol, '1h', activeSymbol.includes('/'));
  const r = rsiSeries(bars, RSI_PARAMS.len, RSI_PARAMS.src);
  const expected = r.length ? r[r.length - 1].value : null;
  // live-tail patching can move it a little between fetches — same ballpark is proof
  return expected != null && Math.abs(v - expected) < 5;
});

// t4 — drag: real mouse gesture on the RSI pane moves the alert value and persists.
const seed = await p.evaluate(() => {
  const a = alerts.find(z => z.source === 'rsi');
  a.value = 50; a._last = null; saveAlerts();
  const r = rsiEl.getBoundingClientRect();
  const y = rsiLine.priceToCoordinate(50);
  return { x: r.left + Math.floor((r.width - 90) / 2), y: r.top + y, top: r.top };
});
await p.mouse.move(seed.x, seed.y);
await p.mouse.down();
await p.mouse.move(seed.x, seed.y - 30, { steps: 6 });
await p.mouse.up();
const t4 = await p.evaluate(() => {
  const a = alerts.find(z => z.source === 'rsi');
  const saved = JSON.parse(localStorage.getItem(alertsKey()) || '[]').find(z => z.id === a.id);
  const moved = a.value > 51 && a.value <= 100;      // dragged up ⇒ higher RSI value
  const persisted = saved && Math.abs(saved.value - a.value) < 1e-9;
  const line = rsiAlertLines.find(e => e.id === a.id);
  const lineMoved = line && Math.abs(line.pl.options().price - a.value) < 1e-9;
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return moved && persisted && lineMoved;
});

console.log(JSON.stringify({ t1_intervalUI: t1, t2_persist: t2, t3_intervalEval: t3, t4_drag: t4, errs }, null, 2));
await b.close();
const ok = t1 && t2 && t3 && t4 && errs.length === 0;
process.exit(ok ? 0 : 1);
