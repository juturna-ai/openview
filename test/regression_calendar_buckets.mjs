// Regression: 1W/2W/1M/1Y bars must be CALENDAR-aligned like TradingView/Binance.
// Pre-fix, aggregate() floored bar times to epoch-aligned buckets: epoch day
// (1970-01-01) was a THURSDAY, so weekly bars ran Thu→Wed (wrong OHLC vs every
// charting platform), "1M" was a fixed 30-day block drifting across months, and
// "1Y" a fixed 365-day block. Extracts bucketStart/bucketClose/aggregate from
// index.html and asserts Monday-anchored weeks, true calendar months/years, and
// untouched epoch alignment for intraday buckets.
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dir = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dir, '..', 'index.html'), 'utf8');

function grab(re){ const m = re.exec(html); if(!m) throw new Error('source not found: '+re); return m[0]; }
const src = [
  grab(/const WEEK_ANCHOR = [^\n]+/),
  grab(/function bucketStart\(time, bucket\)\{[\s\S]*?\n\}/),
  grab(/function bucketClose\(time, bucket\)\{[\s\S]*?\n\}/),
  grab(/function aggregate\(bars, base, bucket\)\{[\s\S]*?\n\}/),
].join('\n');
const { bucketStart, bucketClose, aggregate } =
  new Function(src + '; return { bucketStart, bucketClose, aggregate };')();

let pass=0, fail=0;
const ok=(n,c)=>{ (c?pass++:fail++); console.log((c?'PASS':'FAIL')+' '+n); };
const utc=(y,mo,d)=>Date.UTC(y,mo-1,d)/1000;
const day=t=>new Date(t*1000).getUTCDay();      // 1 = Monday
const iso=t=>new Date(t*1000).toISOString().slice(0,10);

// ── 1W: any timestamp buckets to its week's MONDAY 00:00 UTC ──
const thu = utc(2026,7,9);                       // Thursday 2026-07-09
ok('1W bucket of Thu 2026-07-09 starts Mon 2026-07-06', iso(bucketStart(thu,604800))==='2026-07-06');
ok('1W bucket day is Monday', day(bucketStart(thu,604800))===1);
ok('1W bucket of Sun 2026-07-12 is same week', iso(bucketStart(utc(2026,7,12),604800))==='2026-07-06');
ok('1W bucket of Mon 2026-07-06 is itself', iso(bucketStart(utc(2026,7,6),604800))==='2026-07-06');

// ── 2W: Monday-anchored; the bar containing 2026-07-09 spans Jul 6 → Jul 19 ──
ok('2W bucket of 2026-07-09 starts Mon 2026-07-06', iso(bucketStart(thu,1209600))==='2026-07-06');
ok('2W close is Mon 2026-07-20', iso(bucketClose(thu,1209600))==='2026-07-20');

// ── 1M: true calendar months ──
ok('1M bucket of 2026-07-09 starts 2026-07-01', iso(bucketStart(thu,2592000))==='2026-07-01');
ok('1M bucket of 2026-02-15 starts 2026-02-01', iso(bucketStart(utc(2026,2,15),2592000))==='2026-02-01');
ok('1M close of 2026-07-09 is 2026-08-01', iso(bucketClose(thu,2592000))==='2026-08-01');
ok('1M close across Dec is Jan 1 next year', iso(bucketClose(utc(2026,12,20),2592000))==='2027-01-01');

// ── 1Y: true calendar years ──
ok('1Y bucket of 2026-07-09 starts 2026-01-01', iso(bucketStart(thu,31536000))==='2026-01-01');
ok('1Y close is 2027-01-01', iso(bucketClose(thu,31536000))==='2027-01-01');

// ── Intraday buckets stay epoch-aligned (unchanged behavior) ──
ok('1h bucket epoch-aligned', bucketStart(3605,3600)===3600);
ok('4h bucket epoch-aligned', bucketStart(50000,14400)===43200);

// ── aggregate(): daily bars roll into Monday-anchored weekly OHLC ──
const bars=[]; // Mon 2026-06-29 .. Sun 2026-07-12 (two full ISO weeks)
for(let i=0;i<14;i++){ const t=utc(2026,6,29)+i*86400;
  bars.push({time:t, open:100+i, high:110+i, low:90+i, close:105+i, volume:1}); }
const wk = aggregate(bars, 86400, 604800);
ok('aggregate: 14 daily bars → 2 weekly bars', wk.length===2);
ok('aggregate: week 1 opens Mon 2026-06-29', iso(wk[0].time)==='2026-06-29');
ok('aggregate: week 2 opens Mon 2026-07-06', iso(wk[1].time)==='2026-07-06');
ok('aggregate: week 1 open = Monday bar open', wk[0].open===100);
ok('aggregate: week 1 close = Sunday bar close', wk[0].close===105+6);
ok('aggregate: week 1 high = max of its 7 days', wk[0].high===110+6);
ok('aggregate: week 1 low = min of its 7 days', wk[0].low===90);

// ── aggregate(): daily bars roll into calendar-month OHLC ──
const mbars=[]; // 2026-06-15 .. 2026-07-10
for(let i=0;i<26;i++){ const t=utc(2026,6,15)+i*86400;
  mbars.push({time:t, open:1+i, high:2+i, low:0.5+i, close:1.5+i, volume:1}); }
const mo = aggregate(mbars, 86400, 2592000);
ok('aggregate: spans exactly 2 calendar months', mo.length===2);
ok('aggregate: month buckets are Jun 1 + Jul 1', iso(mo[0].time)==='2026-06-01' && iso(mo[1].time)==='2026-07-01');
ok('aggregate: July open = Jul 1 bar open', mo[1].open===1+16);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
