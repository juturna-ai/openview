// New alerts default to NO expiration (blank field; expiry only set when the user
// picks a date), and the alert-line context menu no longer offers "Change alerts color…".
//   Run:  node test/regression_alert_defaults.mjs
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
  // t1 — quick alert (⊕ tap) carries no expiration.
  alerts.length = 0;
  addQuickAlert(123.45);
  const quickNoExpiry = alerts.length === 1 && alerts[0].expiry == null;

  // t2 — the Create-alert dialog opens with a BLANK expiration field.
  openAlertDialog({});
  const dlgExpiryBlank = document.getElementById('ad_expiry').value === '';
  closeAlertDlg();

  // t3 — dialog Create with the field left blank → expiry stays null.
  openAlertDialog({ price: 200 });
  alertDlg.querySelector('#adOk').click();
  const created = alerts[alerts.length - 1];
  const createdNoExpiry = alerts.length === 2 && created.expiry == null;

  // t4 — alert context menu has Pause/Edit/Delete but no "Change alerts color…".
  showAlertMenu(alerts[0].id, 100, 100);
  const menuText = ctxMenu.textContent;
  hideCtx();
  const noColorItem = !/Change alerts color/.test(menuText) && /Delete/.test(menuText);

  alerts.length = 0; saveAlerts(); renderAlertsPanel(); redraw();
  return { quickNoExpiry, dlgExpiryBlank, createdNoExpiry, noColorItem };
});

const ok = res.quickNoExpiry && res.dlgExpiryBlank && res.createdNoExpiry && res.noColorItem;
console.log(JSON.stringify({ ...res, errs }, null, 2));
await b.close();
process.exit(ok && errs.length === 0 ? 0 : 1);
