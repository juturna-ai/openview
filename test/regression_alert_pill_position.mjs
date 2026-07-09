// The alert-line hover pill must sit RIGHT-ALIGNED against the plot edge — just
// left of the price axis — so the axis gutter (incl. the last-price badge) is
// never covered while hovering.
//   Run:  node test/regression_alert_pill_position.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1200, height: 800 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

const res = await p.evaluate(() => {
  const cur = lastData.length ? lastData[lastData.length - 1].close : 100;
  alerts.length = 0;
  alerts.push({ id: 'aP', source: 'price', op: 'crossing', target: 'value', value: cur,
    trigger: 'once', expiry: null, message: '', notify: {}, active: true, _last: null, interval: null });
  saveAlerts();
  draw.alertHover = 'aP';
  draw.mouse = { x: 200, y: priceToY(cur) };
  drawAlertLines();
  const h = alertHitboxes.find(z => z.id === 'aP');
  draw.alertHover = null;
  const plotRight = dcanvas.clientWidth - axisW();
  const out = {
    hasPill: !!(h && h.pill),
    right: h && h.pill ? h.pill.x + h.pill.w : null,
    plotRight,
  };
  alerts.length = 0; saveAlerts(); renderAlertsPanel(); redraw();
  return out;
});

// t1 — pill never overlaps the price-axis gutter.
const t1 = res.hasPill && res.right <= res.plotRight;
// t2 — pill is right-aligned (flush against the plot edge, within a few px).
const t2 = res.hasPill && res.right >= res.plotRight - 10;

console.log(JSON.stringify({ t1_clearOfAxis: t1, t2_rightAligned: t2, ...res, errs }, null, 2));
await b.close();
process.exit(t1 && t2 && errs.length === 0 ? 0 : 1);
