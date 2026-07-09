// Investigate the yellow/gold warning-triangle badge on the RSI right price axis.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5501/?embed=1&sym=BTC-USD&tf=1m';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('console', m => { if (/error/i.test(m.type())) console.log('[console]', m.type(), m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(6000);

  // Confirm RSI pane exists / visible
  const rsiInfo = await page.evaluate(() => {
    const el = document.getElementById('rsi');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, rect: r, display: getComputedStyle(el).display };
  });
  console.log('RSI pane info:', rsiInfo);

  // Screenshot RSI pane BEFORE any alert
  await page.screenshot({ path: '/home/morrison/projects/openview/openvieweb/test/rsi_triangle_before_alert.png', clip: { x: 0, y: Math.max(0, rsiInfo.rect.y - 10), width: 900, height: rsiInfo.rect.height + 40 } });
  console.log('wrote before_alert screenshot');

  // Explore globals available for creating an RSI alert
  const globalsProbe = await page.evaluate(() => {
    return {
      hasOpenAlertDialog: typeof window.openAlertDialog,
      hasAlerts: typeof window.alerts,
      alertsLen: (window.alerts || []).length,
      hasUpdateRsiAlertLines: typeof window.updateRsiAlertLines,
      hasAlertLinesVisible: typeof window.alertLinesVisible,
      hasSaveAlerts: typeof window.saveAlerts,
      hasMigrateAlert: typeof window.migrateAlert,
      hasRsiLine: typeof window.rsiLine,
      hasRsiChart: typeof window.rsiChart,
      hasRedraw: typeof window.redraw,
    };
  });
  console.log('Globals probe:', globalsProbe);

  // Directly push an RSI alert object into the alerts array (module-scope, so try both
  // window.alerts and a direct approach via evaluate closures if alerts isn't on window).
  const createResult = await page.evaluate(() => {
    try {
      // alerts/migrateAlert/updateRsiAlertLines may be module-scoped consts, not on window.
      // Try window first.
      if (typeof alerts !== 'undefined') {
        const a = {
          id: 'test' + Date.now(),
          source: 'rsi', op: 'crossing', target: 'value', value: 55,
          trigger: 'once', expiry: null, interval: null,
          message: 'test rsi alert', notify: { popup: true, sound: true, browser: false, email: false },
          sound: { kind: 'ringtone', id: 'zelda' },
          active: true, _last: null,
        };
        alerts.push(a);
        if (typeof saveAlerts === 'function') saveAlerts();
        if (typeof updateRsiAlertLines === 'function') updateRsiAlertLines();
        if (typeof redraw === 'function') redraw();
        return { ok: true, alertsLen: alerts.length };
      }
      return { ok: false, reason: 'alerts not in scope' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  console.log('Create RSI alert result:', createResult);

  await page.waitForTimeout(1000);

  const rsiInfo2 = await page.evaluate(() => {
    const el = document.getElementById('rsi');
    const r = el.getBoundingClientRect();
    return { rect: r };
  });
  await page.screenshot({ path: '/home/morrison/projects/openview/openvieweb/test/rsi_triangle_with_alert.png', clip: { x: 0, y: Math.max(0, rsiInfo2.rect.y - 10), width: 900, height: rsiInfo2.rect.height + 40 } });
  console.log('wrote with_alert screenshot');

  // Enumerate DOM near the RSI axis for warning glyphs / yellow backgrounds
  const domScan = await page.evaluate(() => {
    const el = document.getElementById('rsi');
    const wrap = document.getElementById('rsiWrap') || el.parentElement;
    const all = wrap.querySelectorAll('*');
    const hits = [];
    const yellowish = /(230,\s*180,\s*0)|(#e6b400)|(#ffca28)|(#ffb300)|(#f59e0b)|(255,\s*202,\s*40)|(255,\s*179,\s*0)|(245,\s*158,\s*11)/i;
    all.forEach(node => {
      const txt = (node.textContent || '').trim();
      const cs = getComputedStyle(node);
      const bg = cs.backgroundColor;
      const hasWarnGlyph = /[⚠⚠️]/.test(txt) && node.children.length === 0;
      const hasYellowBg = yellowish.test(bg) || yellowish.test(node.getAttribute('style') || '');
      if (hasWarnGlyph || hasYellowBg) {
        const r = node.getBoundingClientRect();
        hits.push({
          tag: node.tagName, id: node.id, className: node.className,
          text: txt.slice(0, 50), inlineStyle: node.getAttribute('style'),
          bg, rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        });
      }
    });
    return hits;
  });
  console.log('DOM scan hits near RSI:', JSON.stringify(domScan, null, 2));

  // Dump alerts + rsiAlertLines + priceline info
  const alertDump = await page.evaluate(() => {
    const out = { alerts: null, rsiAlertLines: null, alertLinesVisible: null };
    try { out.alerts = JSON.parse(JSON.stringify(alerts)); } catch (e) { out.alertsErr = e.message; }
    try { out.rsiAlertLines = rsiAlertLines.map(e => ({ id: e.id, options: e.pl.options ? e.pl.options() : null })); } catch (e) { out.rsiAlertLinesErr = e.message; }
    try { out.alertLinesVisible = alertLinesVisible; } catch (e) {}
    return out;
  });
  console.log('Alert dump:', JSON.stringify(alertDump, null, 2));

  // Check rsiLine / rsiMa lastValueVisible + colors to confirm the two pills
  const seriesDump = await page.evaluate(() => {
    const out = {};
    try { out.rsiLineOptions = rsiLine.options(); } catch (e) { out.rsiLineErr = e.message; }
    try { out.rsiMaOptions = rsiMa.options(); } catch (e) { out.rsiMaErr = e.message; }
    try { out.rsiValText = document.getElementById('rsiVal').textContent; } catch (e) {}
    try { out.rsiMaValText = document.getElementById('rsiMaVal').textContent; } catch (e) {}
    return out;
  });
  console.log('Series dump:', JSON.stringify(seriesDump, null, 2));

  // KEY EXPERIMENT: remove alerts, screenshot again
  const removeResult = await page.evaluate(() => {
    try {
      alerts.length = 0;
      if (typeof saveAlerts === 'function') saveAlerts();
      if (typeof updateRsiAlertLines === 'function') updateRsiAlertLines();
      if (typeof redraw === 'function') redraw();
      return { ok: true, alertsLen: alerts.length };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  console.log('Remove alerts result:', removeResult);
  await page.waitForTimeout(800);

  const rsiInfo3 = await page.evaluate(() => {
    const el = document.getElementById('rsi'); const r = el.getBoundingClientRect(); return { rect: r };
  });
  await page.screenshot({ path: '/home/morrison/projects/openview/openvieweb/test/rsi_triangle_after_remove.png', clip: { x: 0, y: Math.max(0, rsiInfo3.rect.y - 10), width: 900, height: rsiInfo3.rect.height + 40 } });
  console.log('wrote after_remove screenshot');

  // Now toggle alertLinesVisible=false explicitly (re-add an alert first, then hide lines)
  const toggleResult = await page.evaluate(() => {
    try {
      const a = {
        id: 'test2' + Date.now(),
        source: 'rsi', op: 'crossing', target: 'value', value: 60,
        trigger: 'once', expiry: null, interval: null,
        message: 'test rsi alert 2', notify: { popup: true, sound: true, browser: false, email: false },
        sound: { kind: 'ringtone', id: 'zelda' },
        active: true, _last: null,
      };
      alerts.push(a);
      alertLinesVisible = false;
      if (typeof updateRsiAlertLines === 'function') updateRsiAlertLines();
      if (typeof redraw === 'function') redraw();
      return { ok: true, alertsLen: alerts.length, alertLinesVisible };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  console.log('Toggle alertLinesVisible=false (with alert present) result:', toggleResult);
  await page.waitForTimeout(800);

  const rsiInfo4 = await page.evaluate(() => {
    const el = document.getElementById('rsi'); const r = el.getBoundingClientRect(); return { rect: r };
  });
  await page.screenshot({ path: '/home/morrison/projects/openview/openvieweb/test/rsi_triangle_lines_hidden.png', clip: { x: 0, y: Math.max(0, rsiInfo4.rect.y - 10), width: 900, height: rsiInfo4.rect.height + 40 } });
  console.log('wrote lines_hidden screenshot');

  // Zoomed close-up crop of just the axis gutter (right edge of RSI pane) for all 4 states
  console.log('Done. Screenshots in test/: rsi_triangle_before_alert.png, rsi_triangle_with_alert.png, rsi_triangle_after_remove.png, rsi_triangle_lines_hidden.png');

  await browser.close();
})();
