// Bug repro — on touch, tapping an alert line shows the on-line pill, but tapping
// ANYWHERE ELSE must hide it again. No mousemove fires between taps on a phone, so
// the hover set by the line tap used to stick forever (pill never dismissed).
//   Run:  node test/regression_alert_pill_tap_away.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1200, height: 800 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

const res = await p.evaluate(async () => {
  const cur = lastData.length ? lastData[lastData.length - 1].close : 100;
  alerts.length = 0;
  alerts.push({ id: 'aT', source: 'price', op: 'crossing', target: 'value', value: cur,
    trigger: 'once', expiry: 0, message: '', notify: {}, active: true, _last: null, interval: null });
  saveAlerts(); redraw();

  const r = dcanvas.getBoundingClientRect();
  const tap = (x, y) => {   // same synthetic events the touch bridge dispatches for a tap
    for (const type of ['mousedown', 'mouseup']) {
      dcanvas.dispatchEvent(new MouseEvent(type, {
        clientX: r.left + x, clientY: r.top + y, button: 0,
        buttons: type === 'mouseup' ? 0 : 1, bubbles: true, cancelable: true, view: window,
      }));
    }
  };

  const lineY = priceToY(alerts[0].value);
  tap(200, lineY);                            // tap ON the line
  const shownAfterLineTap = draw.alertHover === 'aT';

  tap(200, lineY + 120);                      // tap AWAY from the line (empty chart)
  const hiddenAfterAwayTap = draw.alertHover == null;

  alerts.length = 0; saveAlerts(); renderAlertsPanel(); redraw();
  return { shownAfterLineTap, hiddenAfterAwayTap };
});

const ok = res.shownAfterLineTap && res.hiddenAfterAwayTap;
console.log(JSON.stringify({ t1_shownOnLineTap: res.shownAfterLineTap, t2_hiddenOnAwayTap: res.hiddenAfterAwayTap, errs }, null, 2));
await b.close();
process.exit(ok && errs.length === 0 ? 0 : 1);
