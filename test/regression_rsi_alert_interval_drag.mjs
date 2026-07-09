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
  // New alerts default to the CHART's timeframe (a concrete TF), never an empty
  // "same as chart" — so every indicator alert carries a TF that shows in its label.
  const noEmptyOption = ![...sel.options].some(o => o.value === '');
  const defaultsToChartTF = sel.value === activeTF;
  const visForRsi = row && row.style.display !== 'none';
  document.getElementById('ad_source').value = 'price';
  document.getElementById('ad_source').onchange();
  const hiddenForPrice = row.style.display === 'none';
  closeAlertDlg();
  return hasTfs && noEmptyOption && defaultsToChartTF && visForRsi && hiddenForPrice;
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

// t5 — TOUCH drag (mobile): real CDP touch input on the line moves + persists.
// The phone has no mouse, so this is the path that actually matters on device.
const seed5 = await p.evaluate(() => {
  const a = { id: 'aT5', source: 'rsi', op: 'crossing', target: 'value', value: 50,
    trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null, interval: null };
  alerts.length = 0; alerts.push(a); saveAlerts();
  const r = rsiEl.getBoundingClientRect();
  return { x: Math.floor(r.left + (r.width - 90) / 2), y: Math.floor(r.top + rsiLine.priceToCoordinate(50)) };
});
const cdp = await p.context().newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', seed5.x, seed5.y);
await touch('touchMove', seed5.x, seed5.y - 30);
await touch('touchEnd', seed5.x, seed5.y - 30);
await p.waitForTimeout(80);
const t5 = await p.evaluate(() => {
  const cur = alerts.find(z => z.id === 'aT5');
  const saved = JSON.parse(localStorage.getItem(alertsKey()) || '[]').find(z => z.id === 'aT5');
  const ok = cur && cur.value > 51 && cur.value <= 100 && saved && Math.abs(saved.value - cur.value) < 1e-9;
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return !!ok;
});

// t6 — hover shows the on-line pill with the alert description + trash icon.
const seed6 = await p.evaluate(() => {
  const a = { id: 'aT6', source: 'rsi', op: 'crossing', target: 'value', value: 55.85,
    trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null, interval: '1d' };
  alerts.length = 0; alerts.push(a); saveAlerts();
  const r = rsiEl.getBoundingClientRect();
  return { x: Math.floor(r.left + (r.width - 90) / 2), y: Math.floor(r.top + rsiLine.priceToCoordinate(55.85)) };
});
await p.mouse.move(seed6.x + 10, seed6.y + 40);
await p.mouse.move(seed6.x, seed6.y);   // settle onto the line
await p.waitForTimeout(80);
const t6 = await p.evaluate(() => {
  const pill = document.getElementById('rsiAlertPill');
  const shown = pill && getComputedStyle(pill).display !== 'none';
  const txt = pill.querySelector('.txt').textContent;
  const hasTrash = !!pill.querySelector('.trash');
  return shown && /RSI/i.test(txt) && /55\.85/.test(txt) && hasTrash;
});

// t7 — right-click the line opens the Pause/Edit/Delete menu (showAlertMenu), NOT
// the generic pane "Add alert on RSI" menu.
await p.mouse.move(seed6.x, seed6.y);
await p.mouse.click(seed6.x, seed6.y, { button: 'right' });
await p.waitForTimeout(80);
const t7 = await p.evaluate(() => {
  const m = document.getElementById('ctxMenu');
  const open = m && getComputedStyle(m).display !== 'none';
  const txt = m.textContent || '';
  const ok = open && /Pause|Resume/.test(txt) && /Edit/.test(txt) && /Delete/.test(txt)
    && !/Add alert on/.test(txt);
  hideCtx();
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return ok;
});

// t8 — an RSI alert created WITHOUT touching the interval dropdown still stores a
// concrete TF (the chart's activeTF), never null — so its label always shows a TF.
const t8 = await p.evaluate(() => {
  alerts.length = 0; saveAlerts();
  openAlertDialog({ source: 'rsi' });   // leave Interval at its default
  const $ = id => document.getElementById(id);
  $('ad_op').value = 'crossing'; $('ad_target').value = 'value'; $('ad_value').value = '60';
  $('adOk').click();
  const a = alerts.find(z => z.source === 'rsi');
  const ok = !!a && a.interval === activeTF && a.interval != null;
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return ok;
});

// t9 — an OLD indicator alert stored with interval:null is healed to the chart TF on
// load (backfill), so pre-interval-feature alerts also show a timeframe. Not destructive.
const t9 = await p.evaluate(() => {
  const legacy = [{ id: 'aLegacy', source: 'rsi', op: 'crossing', target: 'value', value: 58.933,
    trigger: 'once', expiry: null, message: '', notify: { popup: true }, sound: { kind: 'sound', id: 'beep' },
    active: true, interval: null }];
  localStorage.setItem(alertsKey(), JSON.stringify(legacy));
  loadAlerts();   // re-load from storage → backfill should run
  const a = alerts.find(z => z.id === 'aLegacy');
  const saved = JSON.parse(localStorage.getItem(alertsKey()) || '[]').find(z => z.id === 'aLegacy');
  const ok = !!a && a.interval === activeTF && a.interval != null
    && !!saved && saved.interval === activeTF;   // healed value persisted
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return ok;
});

console.log(JSON.stringify({ t1_intervalUI: t1, t2_persist: t2, t3_intervalEval: t3, t4_drag: t4, t5_touchDrag: t5, t6_hoverPill: t6, t7_ctxMenu: t7, t8_defaultTF: t8, t9_backfill: t9, errs }, null, 2));
await b.close();
const ok = t1 && t2 && t3 && t4 && t5 && t6 && t7 && t8 && t9 && errs.length === 0;
process.exit(ok ? 0 : 1);
