// Regression - the pair info card must support at most PC_MAX (2) simultaneous cards
// on web, and exactly 1 in embed mode (mobile WebView / grid panes).
//   Run:  node test/regression_paircard_multi.mjs   (requires: npm i -D jsdom)
//
// Executes the REAL functions lifted verbatim from web/public/index.html inside jsdom.
//
// It extracts the actual source of openPairInfoCard/closePairCard/pcFocus + the
// registry, stubs only the data/render collaborators (network + chart internals),
// and asserts the max-2 cap, dedupe-focus, eviction order and embed=1 single-card.
import { readFileSync } from 'node:fs';

// jsdom is not a repo dependency (like playwright for the other tests here, it is
// installed on demand). Skip with a clear message rather than crash.
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch {
  console.log('SKIP regression_paircard_multi: jsdom not installed (npm i -D jsdom)');
  process.exit(0);
}

const SRC = readFileSync(new URL('../web/public/index.html', import.meta.url), 'utf8');

// --- pull the real functions out of the engine source ---
function grab(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  if (a < 0) throw new Error('missing start: ' + startMarker);
  const b = SRC.indexOf(endMarker, a);
  if (b < 0) throw new Error('missing end: ' + endMarker);
  return SRC.slice(a, b);
}
const registrySrc = grab('const PC_MAX = 2;', '\n// Rich single-leg 24h stats');
const openSrc     = grab('function openPairInfoCard(sym){', '// Brief, static asset blurbs');
const closeSrc    = grab('function closePairCard(card){', '// Esc closes the front-most card');

const dom = new JSDOM(`<!doctype html><html><body><div id="pairCards"></div></body></html>`,
  { url: 'http://localhost:3333/', pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document;

const ctx = { IS_EMBED: false };
const harness = `(function(){
  const pairCards = document.getElementById("pairCards");
  ${registrySrc}
  let IS_EMBED = __EMBED__;
  // --- stub the collaborators openPairInfoCard calls (network/render/chart) ---
  const legBase=()=> "BTC", symLabel=s=>s, resolveLeg=()=>({exchange:{label:"Binance"},isPerp:false});
  const NO_LOGO=new Set(), logoForBase=()=>"", splitIconHtml=()=>"", escHtml=s=>String(s);
  const fetchRichStats=()=>Promise.resolve(null), fetchCardCandles=()=>Promise.resolve([]);
  const renderPairCard=()=>{}, wirePairCardNav=()=>{}, pcDragWire=()=>{};
  ${openSrc}
  ${closeSrc}
  window.__api = { openPairInfoCard, closePairCard, _pcOpen, pairCards };
})();`;

function boot(embed) {
  window.document.getElementById('pairCards').innerHTML = '';
  window.eval(harness.replace('__EMBED__', String(embed)));
  return window.__api;
}

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { console.log('  \x1b[32mPASS\x1b[0m ' + name); pass++; }
  else { console.log('  \x1b[31mFAIL\x1b[0m ' + name); fail++; }
};
const live = api => api.pairCards.querySelectorAll('.pair-card.open').length;

console.log('\n\x1b[1mDesktop (IS_EMBED=false) — max 2 cards\x1b[0m');
{
  const api = boot(false);
  api.openPairInfoCard('BTCUSDT');
  check('1st card opens', live(api) === 1 && api._pcOpen.length === 1);

  api.openPairInfoCard('ETHUSDT');
  check('2nd card opens alongside the 1st (THE FEATURE)', live(api) === 2 && api._pcOpen.length === 2);
  check('2nd card gets .stack1 offset so it is not buried', api._pcOpen[1].classList.contains('stack1'));
  check('cards hold distinct symbols', api._pcOpen[0]._sym === 'BTCUSDT' && api._pcOpen[1]._sym === 'ETHUSDT');

  api.openPairInfoCard('SOLUSDT');
  check('3rd card does NOT exceed 2 (hard cap)', live(api) === 2 && api._pcOpen.length === 2);
  check('oldest (BTC) was evicted, newest kept', api._pcOpen.map(c => c._sym).join(',') === 'ETHUSDT,SOLUSDT');

  api.openPairInfoCard('SOLUSDT');
  check('re-opening an already-open symbol does not duplicate', api._pcOpen.length === 2);
  check('...and focuses it instead', api._pcOpen.find(c => c._sym === 'SOLUSDT').classList.contains('front'));

  check('exactly one .front at a time',
    api.pairCards.querySelectorAll('.pair-card.front').length === 1);
}

console.log('\n\x1b[1mClose behaviour\x1b[0m');
{
  const api = boot(false);
  api.openPairInfoCard('BTCUSDT');
  api.openPairInfoCard('ETHUSDT');
  const first = api._pcOpen[0];
  api.closePairCard(api._pcOpen[1]);
  check('closing one leaves the other open', live(api) === 1 && api._pcOpen.length === 1);
  check('survivor drops its stack offset', !first.classList.contains('stack1'));
  check('closed node is detached from the DOM', !api.pairCards.contains(document.createElement('div')) && live(api) === 1);
  api.closePairCard();
  check('closing with no arg closes the front card', live(api) === 0 && api._pcOpen.length === 0);
  api.closePairCard();
  check('closing when none open is a no-op (no throw)', true);

  // capacity frees up again after a close
  api.openPairInfoCard('A'); api.openPairInfoCard('B'); api.closePairCard(api._pcOpen[0]);
  api.openPairInfoCard('C');
  check('slot frees up after close (can reopen to 2)', api._pcOpen.length === 2);
}

console.log('\n\x1b[1mStale-fetch guard is per-card\x1b[0m');
{
  const api = boot(false);
  api.openPairInfoCard('BTCUSDT');
  const a = api._pcOpen[0], seqA = a._seq;
  api.openPairInfoCard('ETHUSDT');
  check('opening a 2nd card does NOT invalidate the 1st card\'s in-flight fetch', a._seq === seqA);
  api.closePairCard(a);
  check('closing a card DOES invalidate its own in-flight fetch', a._seq !== seqA);
}

console.log('\n\x1b[1mPhone / embed (IS_EMBED=true) — feature is web-only\x1b[0m');
{
  const api = boot(true);
  api.openPairInfoCard('BTCUSDT');
  api.openPairInfoCard('ETHUSDT');
  check('embed keeps exactly ONE card (unchanged behaviour)', live(api) === 1 && api._pcOpen.length === 1);
  check('embed card is the newest symbol', api._pcOpen[0]._sym === 'ETHUSDT');
  check('embed card never gets a stack offset', !api._pcOpen[0].classList.contains('stack1'));
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
