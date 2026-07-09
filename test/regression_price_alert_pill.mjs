// Bug repro — the price-line hover pill must show the FULL condition label (like the
// RSI-pane pill: "SYM Price Crossing 0.3955"), not just the bare value ("0.3955").
//   Run:  node test/regression_price_alert_pill.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1200, height: 800 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// Seed a price alert and hover it; capture every string drawn to the overlay canvas.
const res = await p.evaluate(() => {
  const cur = lastData.length ? lastData[lastData.length - 1].close : 100;
  alerts.length = 0;
  alerts.push({ id: 'aP', source: 'price', op: 'crossing', target: 'value', value: cur,
    trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null, interval: null });
  saveAlerts();
  const a = alerts[0];
  const expected = defaultAlertMessage(a);      // full label the pill should render

  // Spy on fillText for one drawAlertLines pass with the alert hovered.
  const drawn = [];
  const orig = dctx.fillText.bind(dctx);
  dctx.fillText = (t, x, y) => { drawn.push(String(t)); return orig(t, x, y); };
  draw.alertHover = a.id;
  draw.mouse = { x: 200, y: priceToY(a.value) };
  drawAlertLines();
  dctx.fillText = orig;
  draw.alertHover = null;

  // The pill's label text (excludes the "🔔 …" gutter tag, which starts with the bell).
  const pill = drawn.find(t => !t.startsWith('🔔'));
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return { expected, pill, bareValueOnly: pill === (Math.round(cur * 1000) / 1000).toString() };
});

// t1 — the pill renders the full condition label, not just the number.
const t1 = res.pill === res.expected && /Crossing/.test(res.pill) && !res.bareValueOnly;

console.log(JSON.stringify({ t1_fullLabel: t1, pill: res.pill, expected: res.expected, errs }, null, 2));
await b.close();
process.exit(t1 && errs.length === 0 ? 0 : 1);
