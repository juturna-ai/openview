// Regression — TradingView-style crosshair ⊕ add-alert + alert-pill long-press menu.
//
// t1: moving the cursor over the plot must draw a ⊕ at the right edge (crossPlusHit set).
// t2+t3: mousedown on the ⊕ immediately creates an alert at the crosshair price with
//        default settings (NO intermediate menu).
// t4: HOLDING (long-press, no movement) on the alert line's hover pill opens the
//     Pause/Edit/Delete menu.
//   Run:  node test/regression_crosshair_plus_alert.mjs   (server on :5599 or FV_URL)
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5599/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 360, height: 780 });
const errs = [];
p.on('pageerror', (e) => { if (!/Value is null/.test(e.message)) errs.push(e.message); });

await p.goto(URL + '?embed=1&sym=BTC-USD&tf=1d', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

const mouse = (type, x, y) =>
  p.evaluate(([t, cx, cy]) => {
    const el = document.getElementById('draw');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent(t, { clientX: r.left + cx, clientY: r.top + cy, button: 0, bubbles: true }));
  }, [type, x, y]);

// t1 — hover mid-plot → ⊕ hitbox exists
await mouse('mousemove', 150, 200);
await p.waitForTimeout(150);
const plus = await p.evaluate(() => (typeof crossPlusHit !== 'undefined' && crossPlusHit) ? { ...crossPlusHit } : null);
const t1 = !!plus;

// t2 — mousedown on the ⊕ → alert created immediately, NO menu
let t2 = false, t3 = false;
if (t1) {
  await mouse('mousedown', plus.x, plus.y);
  await mouse('mouseup', plus.x, plus.y);
  await p.waitForTimeout(250);
  t2 = await p.evaluate(() => {
    const m = document.getElementById('ctxMenu');
    return alerts.length === 1 && (!m || m.style.display !== 'block');
  });
  // t3 — the created alert sits at the crosshair price with default settings
  t3 = await p.evaluate(([px]) => {
    if (alerts.length !== 1) return false;
    const a = alerts[0];
    return a.source === 'price' && a.target === 'value' && a.op === 'crossing' &&
      a.active === true && a.trigger === 'once' &&
      Math.abs(a.value - px) / px < 0.001 &&
      a.notify && a.notify.popup === true && a.sound && a.sound.id;
  }, [plus.price]);
}

// t4 — LONG-PRESS (hold, no movement) on the alert pill → Pause/Edit/Delete menu
let t4 = false;
if (t3) {
  const pill = await p.evaluate(() => {
    draw.alertHover = alerts[0].id; redraw();
    const h = alertHitboxes.find((z) => z.id === alerts[0].id);
    return h && h.pill ? { x: h.pill.x + 4, y: h.pill.y + h.pill.h / 2 } : null;
  });
  if (pill) {
    await mouse('mousedown', pill.x, pill.y);
    await p.waitForTimeout(700); // > 450ms hold threshold, no movement, no mouseup
    t4 = await p.evaluate(() => {
      const m = document.getElementById('ctxMenu');
      return m && m.style.display === 'block' &&
        /Pause|Resume/.test(m.textContent) && /Edit/.test(m.textContent) && /Delete/.test(m.textContent);
    });
    await p.evaluate(([x, y]) => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, button: 0, bubbles: true }));
    }, [pill.x, pill.y]);
  }
}

console.log('t1 ⊕ appears on hover           :', t1 ? 'PASS' : 'FAIL');
console.log('t2 ⊕ tap adds directly, no menu :', t2 ? 'PASS' : 'FAIL');
console.log('t3 alert at price w/ defaults   :', t3 ? 'PASS' : 'FAIL');
console.log('t4 pill hold → pause/edit/del   :', t4 ? 'PASS' : 'FAIL');
console.log('page errors                  :', errs.length ? errs : 'none');
await b.close();
process.exit(t1 && t2 && t3 && t4 && !errs.length ? 0 : 1);
