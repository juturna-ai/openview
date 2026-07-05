import { chromium } from 'playwright';

const OUT = '/home/morrison/projects/Freeview/Freeview/test/screenshots';
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const logs = [];
page.on('console', msg => logs.push('[console] ' + msg.text()));
page.on('pageerror', err => logs.push('[pageerror] ' + err.message));

await page.goto('http://127.0.0.1:5501/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// ── 1. Click the Alert bell button to open create-alert dialog ──
const btnAlert = page.locator('#btnAlert');
await btnAlert.click();
await page.waitForTimeout(300);

const dlgOpen = await page.evaluate(() => document.getElementById('alertDlg').classList.contains('open'));
console.log('Alert dialog opened on bell click:', dlgOpen);

// Dump condition (source/op/target) options
const conditionOptions = await page.evaluate(() => {
  const srcSel = document.querySelector('#ad_source');
  const opSel = document.querySelector('#ad_op');
  const tgtSel = document.querySelector('#ad_target');
  const opt = sel => sel ? Array.from(sel.options).map(o => o.value + ':' + o.textContent) : null;
  return {
    source: opt(srcSel),
    op: opt(opSel),
    target: opt(tgtSel),
    triggerOptions: opt(document.querySelector('#ad_trigger')),
    hasExpiry: !!document.querySelector('#ad_expiry'),
    notifyCheckboxes: Array.from(document.querySelectorAll('.alertdlg .notif label')).map(l => l.textContent.trim()),
  };
});
console.log('CONDITION/DIALOG DUMP:', JSON.stringify(conditionOptions, null, 2));

await page.screenshot({ path: OUT + '/s5_alert_dialog.png' });

// ── 2. Create a test alert (price crossing value) ──
await page.selectOption('#ad_op', 'crossUp');
await page.fill('#ad_value', '99999');
await page.click('#adOk');
await page.waitForTimeout(300);

// ── 3. Open Alerts panel (right-click bell per tooltip) ──
await btnAlert.click({ button: 'right' });
await page.waitForTimeout(300);
const panelOpen = await page.evaluate(() => document.getElementById('alertsPanel').classList.contains('open'));
console.log('Alerts panel opened via right-click bell:', panelOpen);
const panelHTML = await page.evaluate(() => document.getElementById('alertsPanel').innerText);
console.log('ALERTS PANEL TEXT:', panelHTML);
await page.screenshot({ path: OUT + '/s5_alerts_panel.png' });

// Check for pause/edit/delete affordances in panel
const panelControls = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('#alertsPanel .pi'));
  return items.map(it => ({ text: it.textContent, hasDeleteX: !!it.querySelector('.x') }));
});
console.log('PANEL ITEM CONTROLS:', JSON.stringify(panelControls));

// close panel
await page.evaluate(() => toggleAlertsPanel(false));

// ── 4. Right-click on chart canvas -> context menu, check for "add alert here" ──
const canvas = page.locator('#dcanvas, canvas').first();
const box = await canvas.boundingBox();
console.log('Canvas bbox:', box);
if (box) {
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.4;
  await page.mouse.click(x, y, { button: 'right' });
  await page.waitForTimeout(300);
  const ctxVisible = await page.evaluate(() => {
    const el = document.getElementById('ctxMenu') || document.querySelector('.ctxmenu, .ctx-menu, #ctx');
    return el ? { found: true, id: el.id, className: el.className, text: el.innerText, display: getComputedStyle(el).display } : { found: false };
  });
  console.log('CONTEXT MENU STATE:', JSON.stringify(ctxVisible));
  await page.screenshot({ path: OUT + '/s5_chart_context_menu.png' });
}

// ── 5. Check window.Notification / permission handling and beep/Audio usage ──
const notifInfo = await page.evaluate(() => ({
  hasNotificationAPI: typeof window.Notification !== 'undefined',
  notifPermission: typeof window.Notification !== 'undefined' ? Notification.permission : null,
  hasBeepFn: typeof beep === 'function',
  hasAudioContext: typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined',
}));
console.log('NOTIF/SOUND INFO:', JSON.stringify(notifInfo));

// ── 6. Inspect in-memory alerts array + persisted localStorage for "once per bar", drawing-based alerts, history/log ──
const alertsState = await page.evaluate(() => {
  return {
    alertsArray: typeof alerts !== 'undefined' ? JSON.parse(JSON.stringify(alerts)) : null,
    ALERT_SOURCES: typeof ALERT_SOURCES !== 'undefined' ? ALERT_SOURCES : null,
    localStorageKeys: Object.keys(localStorage).filter(k => k.toLowerCase().includes('alert')),
    hasAlertHistoryFn: typeof window.alertHistory !== 'undefined' || typeof window.showAlertLog === 'function',
  };
});
console.log('ALERTS STATE:', JSON.stringify(alertsState, null, 2));

console.log('---CONSOLE/PAGE LOGS---');
console.log(logs.join('\n'));

await browser.close();
console.log('DONE');
