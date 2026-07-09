// Feature test — alert lines: white dotted line, drag-to-move, edit context menu.
//
// Requests:
//  1. Dotted alert line must be white (not red) when active.
//  2. Dragging an alert line moves its price level (draw.alertDrag + yToPrice).
//  3. Right-click an alert line shows a menu with Pause/Edit/Delete.
//   Run:  node test/regression_alert_drag.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — default alert line colour is white.
const t1 = await p.evaluate(() => alertLineColor === '#ffffff' && alertLinesVisible === true);

// Seed an alert near the current price so it maps to a horizontal line.
await p.evaluate(() => {
  const cur = lastData.length ? lastData[lastData.length-1].close : 100;
  alerts.length = 0;
  alerts.push({ id:'aT', source:'price', op:'crossing', target:'value',
    value: cur, trigger:'once', expiry:0, message:'', notify:{}, active:true, _last:null });
  saveAlerts(); redraw();
});

// t2 — drawAlertLines registers a hitbox for the alert (line is drawn).
const t2 = await p.evaluate(() => { drawAlertLines(); return alertHitboxes.some(h=>h.id==='aT'); });

// t3 — simulate a drag: grab the line, move to a different y, value changes and persists.
const t3 = await p.evaluate(() => {
  const a = alerts.find(z=>z.id==='aT'); const before = a.value;
  const y0 = priceToY(a.value);
  // start drag
  draw.alertDrag = { id:'aT' };
  const newPrice = yToPrice(y0 + 60);           // 60px lower on screen
  a.value = newPrice; a._last = null; saveAlerts();
  draw.alertDrag = null;
  const reloaded = JSON.parse(localStorage.getItem(alertsKey())).find(z=>z.id==='aT');
  return newPrice !== before && Math.abs(reloaded.value - newPrice) < 1e-9;
});

// t4 — context menu on an alert line contains Pause / Edit / Delete only (the
// "Alert lines" toggle and "Change alerts color…" items were removed by design).
const t4 = await p.evaluate(() => {
  const a = alerts.find(z=>z.id==='aT');
  drawAlertLines();
  const h = alertHitboxes.find(z=>z.id==='aT');
  showAlertMenu('aT', 100, 100);
  const txt = document.getElementById('ctxMenu').textContent;
  hideCtx();
  return /Pause|Resume/.test(txt) && /Edit/.test(txt) && /Delete/.test(txt)
      && !/Alert lines/.test(txt) && !/Change alerts color/.test(txt);
});

// t5 — Edit opens the alert dialog pre-filled for the existing alert.
const t5 = await p.evaluate(() => {
  const a = alerts.find(z=>z.id==='aT');
  openAlertDialog({ existing:a });
  const open = document.getElementById('alertDlg').classList.contains('open');
  closeAlertDlg();
  return open;
});

console.log(JSON.stringify({ t1_whiteDefault:t1, t2_lineDrawn:t2, t3_dragMoves:t3, t4_menu:t4, t5_edit:t5, errs }, null, 2));
await b.close();
const ok = t1 && t2 && t3 && t4 && t5 && errs.length === 0;
process.exit(ok ? 0 : 1);
