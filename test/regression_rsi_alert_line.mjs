// Bug repro — RSI alerts: dialog-created RSI alert must (a) actually be created
// and persisted (it was — the "not created" report is a feedback problem), and
// (b) draw a dashed alert line on the RSI pane, like price alerts do on the
// main pane. Before the fix, (b) fails: drawAlertLines() only handles
// source==="price", so an RSI alert is invisible.
//   Run:  node test/regression_rsi_alert_line.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — create an RSI alert through the real dialog (source=rsi, crossing, value).
// It must land in `alerts` and in localStorage — proving creation itself works.
const t1 = await p.evaluate(() => {
  alerts.length = 0; saveAlerts();
  openAlertDialog();
  const $ = id => document.getElementById(id);
  $('ad_source').value = 'rsi';
  $('ad_op').value = 'crossing';
  $('ad_target').value = 'value';
  $('ad_value').value = '53.988';
  $('adOk').click();
  const a = alerts.find(z => z.source === 'rsi');
  const saved = JSON.parse(localStorage.getItem(alertsKey()) || '[]').find(z => z.source === 'rsi');
  return !!a && a.op === 'crossing' && Math.abs(a.value - 53.988) < 1e-9 &&
         !!saved && Math.abs(saved.value - 53.988) < 1e-9 &&
         !document.getElementById('alertDlg').classList.contains('open');
});

// t2 — the RSI alert draws a dashed line on the RSI pane (native price line on
// rsiLine, tracked in rsiAlertLines) at the alert value.
const t2 = await p.evaluate(() => {
  if (typeof updateRsiAlertLines !== 'function' || typeof rsiAlertLines === 'undefined') return false;
  const ent = rsiAlertLines[0];
  return rsiAlertLines.length === 1 && !!ent && Math.abs(ent.pl.options().price - 53.988) < 1e-9;
});

// t3 — "Alert lines" visibility toggle removes/restores the RSI line too.
const t3 = await p.evaluate(() => {
  if (typeof updateRsiAlertLines !== 'function') return false;
  alertLinesVisible = false; updateRsiAlertLines();
  const off = rsiAlertLines.length === 0;
  alertLinesVisible = true; updateRsiAlertLines();
  return off && rsiAlertLines.length === 1;
});

// t4 — deleting the alert removes the RSI line; price alerts are unaffected by
// the new code path (still no rsi lines for them).
const t4 = await p.evaluate(() => {
  if (typeof rsiAlertLines === 'undefined') return false;
  removeAlert(alerts.find(z => z.source === 'rsi').id);
  const gone = rsiAlertLines.length === 0 && alerts.length === 0;
  const cur = lastData.length ? lastData[lastData.length - 1].close : 100;
  alerts.push({ id: 'aP', source: 'price', op: 'crossing', target: 'value',
    value: cur, trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null });
  saveAlerts(); redraw();
  const priceOnMain = alertHitboxes.some(h => h.id === 'aP');
  const noRsiLine = rsiAlertLines.length === 0;
  removeAlert('aP');
  return gone && priceOnMain && noRsiLine;
});

console.log(JSON.stringify({ t1_created: t1, t2_rsiLine: t2, t3_visToggle: t3, t4_cleanup: t4, errs }, null, 2));
await b.close();
const ok = t1 && t2 && t3 && t4 && errs.length === 0;
process.exit(ok ? 0 : 1);
