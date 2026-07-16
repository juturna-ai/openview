// Regression - every ASSET_INFO key must be reachable via legBase() for the symbol
// formats the app actually produces (Coinbase BTC-USD, Binance BINANCE:XUSDT,
// Yahoo YAHOO:GC=F). A key legBase can never emit renders no description.
//
// Reads EX/resolveLeg/legBase/ASSET_INFO live out of web/public/index.html so this
// test tracks the real source instead of a frozen copy.
//   Run:  node test/regression_assetinfo_legbase.mjs
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../web/public/index.html', import.meta.url), 'utf8');
const slice = (a, b) => { const i = SRC.indexOf(a); const j = SRC.indexOf(b, i); 
  if (i < 0 || j < 0) throw new Error('could not locate ' + a + ' .. ' + b + ' in index.html');
  return SRC.slice(i, j); };

const deps = slice('const EX = {', '// Human label for a leg');       // EX + resolveLeg + legBase
const info = slice('const ASSET_INFO = {', '\nfunction renderPairCard');
const { legBase, ASSET_INFO } = new Function(`${deps}\n${info}\nreturn { legBase, ASSET_INFO };`)();

const CASES = [
  ['BTC-USD','BTC'], ['XRP-USD','XRP'], ['BNB-USD','BNB'], ['ETH-USD','ETH'],
  ['BINANCE:BNBUSDT','BNB'], ['BINANCE:PEPEUSDT','PEPE'], ['BINANCE:SHIBUSDT','SHIB'],
  ['BINANCE:PAXGUSDT','PAXG'], ['BYBIT:WIFUSDT','WIF'], ['BINANCE:SUIUSDT','SUI'],
  ['BINANCE:GRAMUSDT','GRAM'], ['BINANCE:POLUSDT','POL'], ['BINANCE:USD1USDT','USD1'],
  ['BINANCE:OPNUSDT','OPN'], ['BINANCE:REUSDT','RE'], ['BINANCE:0GUSDT','0G'],
  ['BINANCE:MUBUSDT','MUB'], ['BINANCE:PUMPUSDT','PUMP'], ['BINANCE:XPLUSDT','XPL'],
  ['BINANCE:AIGENSYNUSDT','AIGENSYN'], ['BINANCE:TRUMPUSDT','TRUMP'],
  ['YAHOO:AAPL','AAPL'], ['YAHOO:SPY','SPY'], ['YAHOO:NVDA','NVDA'],
  ['YAHOO:GC=F','GC'], ['YAHOO:CL=F','CL'], ['YAHOO:ES=F','ES'],
];

let pass = 0, fail = 0;
for (const [sym, want] of CASES) {
  let got; try { got = legBase(sym); } catch (e) { got = 'THREW:' + e.message; }
  const hit = !!ASSET_INFO[got];
  const ok = got === want && hit;
  console.log((ok ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m') + ' ' +
    sym.padEnd(22) + '-> ' + String(got).padEnd(10) + (hit ? 'desc ✓' : '\x1b[31mNO DESC\x1b[0m'));
  ok ? pass++ : fail++;
}

// Every key in the map must be a plausible legBase output (uppercase alnum), else it
// is dead weight that can never be looked up.
const deadKeys = Object.keys(ASSET_INFO).filter(k => !/^[A-Z0-9]+$/.test(k));
if (deadKeys.length) { console.log('\n  \x1b[31mFAIL\x1b[0m unreachable keys: ' + deadKeys.join(', ')); fail++; }
else { console.log('\n  \x1b[32mPASS\x1b[0m all ' + Object.keys(ASSET_INFO).length + ' keys are legBase-shaped'); pass++; }

// Every entry must carry a real description and a website.
const bad = Object.entries(ASSET_INFO).filter(([, v]) => !v || !v.d || !v.w || v.d.length < 60);
if (bad.length) { console.log('  \x1b[31mFAIL\x1b[0m entries missing d/w or too short: ' + bad.map(x => x[0]).join(', ')); fail++; }
else { console.log('  \x1b[32mPASS\x1b[0m all entries have a description + website'); pass++; }

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
