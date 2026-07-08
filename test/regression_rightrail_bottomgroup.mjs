// Feature test — §18 item 2: Right rail bottom-group icons.
//
// Requires: Technicals gauge (real MA/oscillator votes → Sell/Neutral/Buy verdict),
// Screener, Economic calendar, News (RSS), Notifications (bell = fired-alerts log
// with unread badge), Apps grid, Help (keyboard-shortcuts dialog). All thin-line
// SVG icons with tooltips; active icon highlights; opens DOCKED in the right sidebar.
//   Run:  node test/regression_rightrail_bottomgroup.mjs
import { chromium } from 'playwright';

const URL = process.env.FV_URL || 'http://127.0.0.1:5501/';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
const errs = [];
p.on('pageerror', e => { if (!/Value is null/.test(e.message)) errs.push(e.message); });
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await p.waitForTimeout(9000);   // let bars load (technicals needs data)

const clickRail = title => p.evaluate(t => {
  [...document.querySelectorAll('#rightRail .rr-btn')].find(x => x.title === t).click();
}, title);
const panelText = () => p.evaluate(() => {
  const box = document.getElementById('rightPanel');            // panels dock here now
  return box && box.classList.contains('open') ? box.textContent : '';
});

// 1) All bottom-group buttons present, all SVG.
const struct = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('#rightRail .rr-btn')];
  return { titles: btns.map(x => x.title), svgAll: btns.every(x => x.querySelector('svg')) };
});
const want = ['Technicals', 'Screener', 'Economic calendar', 'News', 'Notifications', 'Apps', 'Help', 'Paper trading'];
const t1 = want.every(w => struct.titles.includes(w)) && struct.svgAll;

// 2) Technicals opens with a real verdict + vote counts + indicator rows.
await clickRail('Technicals');
await p.waitForTimeout(300);
const tech = await panelText();
const t2 = /Technicals/.test(tech) && /(Strong Buy|Buy|Neutral|Sell|Strong Sell)/.test(tech)
        && /RSI \(14\)/.test(tech) && /MACD/.test(tech) && /SMA 20/.test(tech) && /checks on loaded/.test(tech);

// 3) Economic calendar + Apps stubs open.
await clickRail('Economic calendar'); await p.waitForTimeout(200);
const cal = /Economic Calendar/.test(await panelText());
await clickRail('Apps'); await p.waitForTimeout(200);
const apps = /Apps/.test(await panelText());
const t3 = cal && apps;

// 4) Help lists keyboard shortcuts.
await clickRail('Help'); await p.waitForTimeout(200);
const help = await panelText();
const t4 = /Keyboard shortcuts/.test(help) && /Ctrl\+Z/.test(help) && /Alt\+H/.test(help);

// 5) Notifications: seed a fired alert into the log → badge shows unread; opening
//    the panel lists it and clears the badge.
await p.evaluate(() => { localStorage.removeItem('fv_notif_seen'); logAlert({ ts: Date.now(), symbol: 'TEST-USD', text: 'test alert fired' }); });
await p.waitForTimeout(200);
const badgeBefore = await p.evaluate(() => {
  const el = document.querySelector('#rightRail .rr-btn[data-rail="notif"] .rr-badge');
  return el ? el.textContent : null;
});
await clickRail('Notifications'); await p.waitForTimeout(300);
const notifText = await panelText();
const badgeAfter = await p.evaluate(() => !!document.querySelector('#rightRail .rr-btn[data-rail="notif"] .rr-badge'));
const t5 = badgeBefore !== null && +badgeBefore >= 1 && /test alert fired/.test(notifText) && badgeAfter === false;

// 6) Active highlight follows the last click (Notifications).
const t6 = await p.evaluate(() => {
  const b = [...document.querySelectorAll('#rightRail .rr-btn')].find(x => x.title === 'Notifications');
  return b.classList.contains('rr-active');
});

const t7 = errs.length === 0;

console.log('t1 8 bottom+paper SVG btns :', t1, struct.titles.join(','));
console.log('t2 technicals real verdict :', t2);
console.log('t3 calendar+apps stubs     :', t3);
console.log('t4 help shortcuts dialog   :', t4);
console.log('t5 notif badge + log + clear:', t5, `badge=${badgeBefore}`);
console.log('t6 active highlight        :', t6);
console.log('t7 no app errors           :', t7, errs.slice(0, 3));

await b.close();
const ok = t1 && t2 && t3 && t4 && t5 && t6 && t7;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
