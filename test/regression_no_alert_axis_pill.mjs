// Regression — alert lines must NOT show a value pill on the right price axis, even
// while hovered. The on-line hover pill (full condition + trash) is the only alert UI:
//   t1: hovering a PRICE alert draws no "🔔 …" gutter tag on the overlay canvas.
//   t2: hovering an RSI alert leaves its native price line's axisLabelVisible=false / title="".
//   Run:  node test/regression_no_alert_axis_pill.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — hovered price alert: capture everything drawn during drawAlertLines; the on-line
// pill label must render, but nothing bell-prefixed (the old axis gutter tag) may.
const r1 = await p.evaluate(() => {
  const cur = lastData.length ? lastData[lastData.length - 1].close : 100;
  alerts.length = 0;
  alerts.push({ id: 'aP', source: 'price', op: 'crossing', target: 'value', value: cur,
    trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null, interval: null });
  saveAlerts();
  const drawn = [];
  const orig = dctx.fillText.bind(dctx);
  dctx.fillText = (t, x, y) => { drawn.push(String(t)); return orig(t, x, y); };
  draw.alertHover = 'aP';
  draw.mouse = { x: 200, y: priceToY(cur) };
  drawAlertLines();
  dctx.fillText = orig;
  draw.alertHover = null;
  return { bellTags: drawn.filter(t => t.startsWith('🔔')),
           pillDrawn: drawn.some(t => /Price Crossing/.test(t)) };
});
const t1 = r1.bellTags.length === 0 && r1.pillDrawn;

// t2 — hovered RSI alert: the native price line must keep its axis label hidden.
const r2 = await p.evaluate(() => {
  alerts.length = 0;
  alerts.push({ id: 'aR', source: 'rsi', op: 'crossing', target: 'value', value: 50,
    trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null, interval: null });
  saveAlerts();
  if (typeof updateRsiAlertLines === 'function') updateRsiAlertLines();
  showRsiAlertPill('aR');
  const ent = rsiAlertLines.find(x => x.id === 'aR');
  const opts = ent ? ent.pl.options() : null;
  const shown = document.getElementById('rsiAlertPill').style.display !== 'none';
  hideRsiAlertPill();
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  if (typeof updateRsiAlertLines === 'function') updateRsiAlertLines();
  return opts ? { axis: opts.axisLabelVisible, title: opts.title, pillShown: shown } : null;
});
const t2 = !!r2 && r2.axis === false && r2.title === '' && r2.pillShown;

console.log(JSON.stringify({ t1_noPriceAxisTag: t1, t2_noRsiAxisPill: t2, r1, r2, errs }, null, 2));
await b.close();
process.exit(t1 && t2 && errs.length === 0 ? 0 : 1);
