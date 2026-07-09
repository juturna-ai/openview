// Regression — fireAlert emits {fvx:'alertFired'} to the embedding host.
//
// The mobile app (openviewapp ChartWebView) turns this broadcast into a phone
// notification. In embed mode, firing an alert must postMessage the payload
// (symbol, message, sound, notify) to the parent; outside embed it must NOT emit.
//   Run:  node test/regression_alert_fired_emit.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5502/';
const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', (e) => { if (!/Value is null/.test(e.message)) errs.push(e.message); });

// ── embed mode: alertFired must reach the host ────────────────────────────────
await p.goto(URL + '?embed=1&sym=BTC-USD&tf=1h', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — fireAlert posts an alertFired payload to parent (top-level page: parent === window).
const t1 = await p.evaluate(async () => {
  const got = [];
  window.addEventListener('message', (e) => {
    if (e.data && e.data.fvx === 'alertFired') got.push(e.data);
  });
  fireAlert(
    { id: 'aF', source: 'price', op: 'gt', target: 'value', value: 100, trigger: 'once',
      message: 'test fire', notify: { ...ALERT_DEFAULT_NOTIFY },
      sound: { kind: 'ringtone', id: 'zelda' }, active: true },
    123.45, 100,
  );
  await new Promise((r) => setTimeout(r, 300));
  const m = got[0];
  return {
    ok: !!m && m.symbol === activeSymbol && /test fire/.test(m.message) &&
      m.sound && m.sound.id === 'zelda' && m.sound.kind === 'ringtone' &&
      m.notify && typeof m.notify === 'object',
    got: m || null,
  };
});

// ── non-embed: no emit ────────────────────────────────────────────────────────
await p.goto(URL + '?sym=BTC-USD&tf=1h', { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);
const t2 = await p.evaluate(async () => {
  const got = [];
  window.addEventListener('message', (e) => {
    if (e.data && e.data.fvx === 'alertFired') got.push(e.data);
  });
  fireAlert(
    { id: 'aF2', source: 'price', op: 'gt', target: 'value', value: 100, trigger: 'once',
      message: 'no emit', notify: { ...ALERT_DEFAULT_NOTIFY },
      sound: { kind: 'sound', id: 'beep' }, active: true },
    123.45, 100,
  );
  await new Promise((r) => setTimeout(r, 300));
  return got.length === 0;
});

console.log('t1 embed emits alertFired :', t1.ok ? 'PASS' : `FAIL ${JSON.stringify(t1.got)}`);
console.log('t2 non-embed stays silent :', t2 ? 'PASS' : 'FAIL');
console.log('page errors               :', errs.length ? errs : 'none');
await b.close();
process.exit(t1.ok && t2 && !errs.length ? 0 : 1);
