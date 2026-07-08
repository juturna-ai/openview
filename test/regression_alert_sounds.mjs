// Feature test — alert sound/ringtone picker.
//
// Requests: ≥20 sounds + ≥20 ringtones; ringtones loop ≥10s; each alert stores a
// {kind,id} sound that persists; the dialog exposes a kind selector + option list;
// fireAlert plays the chosen tone (no crash) and stopAlertSound() halts a ringtone.
//   Run:  node test/regression_alert_sounds.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5502/';
const b = await chromium.launch({ headless: true, args:['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(6000);

// t1 — 20 sounds + 20 ringtones, all with unique ids and labels.
const t1 = await p.evaluate(() => {
  const ids = a => new Set(a.map(x=>x.id)).size;
  return ALERT_SOUNDS.length>=20 && ALERT_RINGTONES.length>=20
      && ids(ALERT_SOUNDS)===ALERT_SOUNDS.length && ids(ALERT_RINGTONES)===ALERT_RINGTONES.length
      && ALERT_SOUNDS.every(s=>s.label) && ALERT_RINGTONES.every(s=>s.label);
});

// t2 — every ringtone, looped by the same _melody used at play time, lasts ≥10s.
const t2 = await p.evaluate(() => {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const bad = [];
  for (const r of ALERT_RINGTONES) {
    const ac = new OAC(1, 44100*30, 44100);
    const master = ac.createGain(); master.connect(ac.destination);
    const end = _melody(ac, master, 0, r.seq, { bpm:r.bpm||150, type:r.type||'sine', vol:r.vol||0.15, minDur:RINGTONE_MIN_SEC });
    if (end < 10) bad.push(r.id + ':' + end.toFixed(1));
  }
  return { ok: bad.length===0, bad };
});

// t3 — playing a sound and a ringtone doesn't throw; stopAlertSound clears the handle.
const t3 = await p.evaluate(async () => {
  playAlertSound({kind:'sound', id:'chime'});
  const h = playAlertSound({kind:'ringtone', id:'rt_classic'});
  const playing = !!_activeRing;
  stopAlertSound();
  return playing && _activeRing===null && typeof h.stop==='function';
});

// t4 — an alert persists its chosen sound and reloads it.
const t4 = await p.evaluate(() => {
  const cur = lastData.length ? lastData[lastData.length-1].close : 100;
  alerts.length = 0;
  alerts.push({ id:'aS', source:'price', op:'crossing', target:'value', value:cur,
    trigger:'once', expiry:0, message:'', notify:{...ALERT_DEFAULT_NOTIFY},
    sound:{kind:'ringtone', id:'rt_march'}, active:true, _last:null });
  saveAlerts();
  const back = JSON.parse(localStorage.getItem(alertsKey())).find(z=>z.id==='aS');
  return back.sound && back.sound.kind==='ringtone' && back.sound.id==='rt_march';
});

// t5 — the dialog renders the kind selector + a populated option list, and switching
//      kind repopulates it; fireAlert on a sound-enabled alert doesn't throw.
const t5 = await p.evaluate(() => {
  const a = alerts.find(z=>z.id==='aS');
  openAlertDialog({ existing:a });
  const kindSel = document.getElementById('ad_sound_kind');
  const idSel = document.getElementById('ad_sound_id');
  const ringCount = idSel.options.length;                 // kind=ringtone (from stored)
  kindSel.value='sound'; kindSel.onchange();
  const soundCount = idSel.options.length;
  closeAlertDlg();
  // fire it — must not throw
  a.notify={popup:false,sound:true,browser:false,email:false};
  let threw=false; try{ fireAlert(a, a.value, a.value); }catch(e){ threw=true; }
  stopAlertSound();
  return kindSel && ringCount===20 && soundCount===20 && !threw;
});

console.log(JSON.stringify({ t1_counts:t1, t2_ringLen:t2, t3_playStop:t3, t4_persist:t4, t5_dialogFire:t5, errs }, null, 2));
await b.close();
const ok = t1 && t2.ok && t3 && t4 && t5 && errs.length===0;
process.exit(ok ? 0 : 1);
