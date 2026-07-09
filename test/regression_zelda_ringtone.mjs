// Feature test — "Zelda" ringtone added, "Flute Extended" removed, and Zelda plays in
// FULL (no loop, not force-stopped by the popup/no-popup timeouts) since it's >10s.
//   Run:  node test/regression_zelda_ringtone.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// Stub HTMLAudioElement so we can observe loop/play/pause without real audio.
await p.evaluate(() => {
  window.__audio = [];
  const RealAudio = window.Audio;
  window.Audio = function (src) {
    const el = { src, loop: false, volume: 1, currentTime: 0, paused: true, onended: null,
      play() { this.paused = false; return Promise.resolve(); },
      pause() { this.paused = true; },
      // test helper to simulate the file finishing
      _finish() { if (typeof this.onended === 'function') this.onended(); } };
    window.__audio.push(el);
    return el;
  };
  window.__RealAudio = RealAudio;
});

// t1 — list: Zelda present, Flute Extended gone, still ≥20 ringtones.
const t1 = await p.evaluate(() => {
  const ids = ALERT_RINGTONES.map(r => r.id);
  const zelda = ALERT_RINGTONES.find(r => r.id === 'zelda');
  return ids.includes('zelda') && !ids.includes('flute_extended')
    && zelda && zelda.label === 'Zelda' && zelda.playFull === true
    && /zelda\.mp3$/.test(zelda.src) && ALERT_RINGTONES.length >= 20;
});

// t2 — playing Zelda: audio element created with loop=false and started.
const t2 = await p.evaluate(() => {
  window.__audio.length = 0;
  const h = playAlertSound({ kind: 'ringtone', id: 'zelda' });
  const el = window.__audio[window.__audio.length - 1];
  const ok = el && el.loop === false && el.paused === false && h.playFull === true && _activeRing === h;
  return ok;
});

// t3 — Zelda self-clears _activeRing when it finishes (onended), proving full playthrough.
const t3 = await p.evaluate(() => {
  window.__audio.length = 0;
  playAlertSound({ kind: 'ringtone', id: 'zelda' });
  const el = window.__audio[window.__audio.length - 1];
  const before = _activeRing != null;
  el._finish();                       // simulate the 13s file ending
  return before && _activeRing === null;
});

// t4 — a looping file ringtone (route1) still loops (loop=true) — regression guard.
const t4 = await p.evaluate(() => {
  window.__audio.length = 0;
  const h = playAlertSound({ kind: 'ringtone', id: 'route1' });
  const el = window.__audio[window.__audio.length - 1];
  const ok = el && el.loop === true && !h.playFull;
  stopAlertSound();
  return ok;
});

// t5 — fireAlert with a popup does NOT stop a Zelda (playFull) ring at the 7s timeout;
//      only an explicit popup CLICK stops it. Use fake timers to fast-forward 7s.
const t5 = await p.evaluate(async () => {
  window.__audio.length = 0;
  const realSetTimeout = window.setTimeout;
  const timers = [];
  window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const a = { id: 'aZ', source: 'price', op: 'crossing', target: 'value', value: 1,
    trigger: 'every', expiry: 0, message: 'x', notify: { popup: true, sound: true },
    sound: { kind: 'ringtone', id: 'zelda' }, active: true, _last: null, interval: null };
  fireAlert(a, 1, 1);
  const el = window.__audio[window.__audio.length - 1];
  const startedPlaying = el && el.paused === false;
  // Fire every queued timeout (incl. the 7s toast auto-close) — Zelda must keep playing.
  timers.forEach(t => { try { t.fn(); } catch (e) {} });
  const stillPlaying = el && el.paused === false && _activeRing != null;
  window.setTimeout = realSetTimeout;
  // cleanup
  if (_activeRing) try { _activeRing.stop(); } catch (e) {}
  _activeRing = null;
  return startedPlaying && stillPlaying;
});

// t6 — a NEW alert defaults to the Zelda ringtone with App popup + Sound checked.
const t6 = await p.evaluate(() => {
  alerts.length = 0; saveAlerts();
  openAlertDialog({});                       // fresh alert, no source/sound pre-set
  const $ = id => document.getElementById(id);
  const kind = $('ad_sound_kind').value;     // dialog's live sound-kind selector
  const id = $('ad_sound_id').value;         // …and its selected id
  const popup = $('ad_n_popup').checked;
  const sound = $('ad_n_sound').checked;
  closeAlertDlg();
  return kind === 'ringtone' && id === 'zelda' && popup === true && sound === true;
});

// t7 — after Create, the stored alert carries the Zelda ringtone + popup + sound.
const t7 = await p.evaluate(() => {
  alerts.length = 0; saveAlerts();
  openAlertDialog({});
  const $ = id => document.getElementById(id);
  $('ad_source').value = 'price'; $('ad_target').value = 'value'; $('ad_value').value = '1';
  $('adOk').click();
  const a = alerts[alerts.length - 1];
  const ok = a && a.sound.kind === 'ringtone' && a.sound.id === 'zelda'
    && a.notify.popup === true && a.notify.sound === true;
  alerts.length = 0; saveAlerts(); renderAlertsPanel();
  return ok;
});

console.log(JSON.stringify({ t1_listSwapped: t1, t2_noLoop: t2, t3_selfClears: t3, t4_route1StillLoops: t4, t5_popupDoesntCut: t5, t6_dialogDefault: t6, t7_createdDefault: t7, errs }, null, 2));
await b.close();
const ok = t1 && t2 && t3 && t4 && t5 && t6 && t7 && errs.length === 0;
process.exit(ok ? 0 : 1);
