// Regression — alertFired emits for SPREAD/ratio symbols (A/B), on BOTH host bridges.
//
// User report: spread alerts play the in-page sound but the phone never gets a
// notification. The engine emit is the first link: it must fire for `sym=A/B`
// exactly as for a plain product, via parent.postMessage (web iframe) AND via
// window.ReactNativeWebView.postMessage (native WebView bridge — the path the
// phone actually uses, which regression_alert_fired_emit.mjs does not cover).
//   Run:  node test/regression_alert_fired_spread.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5502/';
const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', (e) => { if (!/Value is null/.test(e.message)) errs.push(e.message); });

const SPREAD = 'ICP-USD/BTC-USD';
await p.goto(URL + '?embed=1&sym=' + encodeURIComponent(SPREAD) + '&tf=1h', {
  waitUntil: 'domcontentloaded', timeout: 20000,
});
await p.waitForTimeout(6000);

// t1 — direct fireAlert: payload reaches BOTH bridges with the spread symbol intact.
const t1 = await p.evaluate(async (SPREAD) => {
  const web = [], native = [];
  window.addEventListener('message', (e) => {
    if (e.data && e.data.fvx === 'alertFired') web.push(e.data);
  });
  // Shim the native WebView bridge exactly as react-native-webview exposes it.
  window.ReactNativeWebView = { postMessage: (s) => native.push(s) };
  fireAlert(
    { id: 'aS', source: 'price', op: 'crossing', target: 'value', value: 0.4, trigger: 'every',
      message: '', notify: { ...ALERT_DEFAULT_NOTIFY },
      sound: { kind: 'ringtone', id: 'zelda' }, active: true },
    0.4023, 0.4,
  );
  await new Promise((r) => setTimeout(r, 300));
  const w = web[0] || null;
  let n = null, nErr = null;
  try { n = native[0] ? JSON.parse(native[0]) : null; } catch (e) { nErr = String(e); }
  return {
    webOk: !!w && w.symbol === SPREAD && !!w.message,
    nativeOk: !!n && n.fvx === 'alertFired' && n.symbol === SPREAD && !!n.message,
    nErr, web: w, native: n,
  };
}, SPREAD);

// t2 — natural path: a live spread alert straddled by the current price must fire
// through checkAlerts() (tick → evaluate → fireAlert), not just via direct call.
const t2 = await p.evaluate(async (SPREAD) => {
  const got = [];
  window.ReactNativeWebView = { postMessage: (s) => { try { const m = JSON.parse(s); if (m.fvx === 'alertFired') got.push(m); } catch (e) {} } };
  const px = lastData.length ? lastData[lastData.length - 1].close : null;
  if (px == null) return { ok: false, why: 'no chart data loaded for spread' };
  // Straddle the live price so the next evaluation crosses it.
  alerts.push({ id: 'aS2', source: 'price', op: 'crossing', target: 'value', value: px,
    trigger: 'every', message: '', notify: { ...ALERT_DEFAULT_NOTIFY },
    sound: { kind: 'sound', id: 'beep' }, active: true, _last: px * 0.99 });
  checkAlerts();
  await new Promise((r) => setTimeout(r, 300));
  const m = got[0] || null;
  return { ok: !!m && m.symbol === SPREAD, got: m, px };
}, SPREAD);

console.log('t1 spread fireAlert → web bridge   :', t1.webOk ? 'PASS' : 'FAIL ' + JSON.stringify(t1.web));
console.log('t1 spread fireAlert → native bridge:', t1.nativeOk ? 'PASS' : 'FAIL ' + JSON.stringify({ n: t1.native, err: t1.nErr }));
console.log('t2 spread checkAlerts natural fire :', t2.ok ? 'PASS' : 'FAIL ' + JSON.stringify(t2));
console.log('page errors                        :', errs.length ? errs.join(' | ') : 'none');
await b.close();
process.exit(t1.webOk && t1.nativeOk && t2.ok && !errs.length ? 0 : 1);
