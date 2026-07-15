// Pure-logic tests for the Pine Script v5 subset interpreter (Pine Editor, right rail).
//
// These do NOT re-implement the interpreter. They slice the real source out of the shipped
// index.html — the engine math helpers (smaA/emaA/rmaA/…) plus the PINE-CORE-START…END block
// — and evaluate it. So the tests exercise the code that actually runs in the browser; if the
// interpreter changes, these move with it, and if the markers/helpers vanish the test fails
// loudly instead of silently passing against a stale copy.
//
// Run: node web/app/home/wallet/pine.logic.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
// web/public/index.html is the file Next.js actually serves — test that one.
const ENGINE = resolve(HERE, '../../../public/index.html');

/* ── Extract the shipped interpreter + the math helpers it delegates to ── */

const html = readFileSync(ENGINE, 'utf8');

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker);
  assert.ok(a !== -1, `marker "${startMarker}" not found in ${ENGINE} — did the Pine block move?`);
  assert.ok(b > a, `marker "${endMarker}" not found after "${startMarker}"`);
  return html.slice(a, b + endMarker.length);
}

// The interpreter calls these engine helpers rather than duplicating the math, so Pine's
// ta.sma matches the built-in SMA exactly. Pull each one out by name.
const HELPERS = ['smaA', 'emaA', 'wmaA', 'rmaA', 'stdevA', 'highestA', 'lowestA', 'atrCalc', 'pair', 'srcArr'];
const helperSrc = HELPERS.map((name) => {
  const re = new RegExp(`^function ${name}\\(`, 'm');
  const m = re.exec(html);
  assert.ok(m, `engine helper ${name}() not found — the Pine interpreter depends on it`);
  // walk braces from the opening { to find the function's end
  const start = m.index;
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return html.slice(start, i + 1);
}).join('\n');

const pineSrc = slice('// PINE-CORE-START', '// PINE-CORE-END');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${helperSrc}\n${pineSrc}`, sandbox, { filename: 'index.html:pine' });
const { pineRun, pineTokenize, pineParse } = sandbox;
assert.ok(typeof pineRun === 'function', 'pineRun did not evaluate out of index.html');

/* ── Fixtures ── */

// Deterministic bars — a gentle sine over a rising trend, so MAs are well-defined and ordered.
const bars = Array.from({ length: 400 }, (_, i) => {
  const base = 100 + i * 0.5 + Math.sin(i / 9) * 6;
  const open = base;
  const close = base + Math.cos(i / 5) * 1.5;
  return {
    time: 1700000000 + i * 3600,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 1000 + (i % 17) * 25,
  };
});
const closes = bars.map((b) => b.close);

// Reference SMA, computed independently of the engine — if both are wrong the same way,
// this catches it.
function refSma(arr, len) {
  return arr.map((_, i) => {
    if (i < len - 1) return null;
    let s = 0;
    for (let j = 0; j < len; j++) s += arr[i - j];
    return s / len;
  });
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ── 1. The golden case: the user's own script from the Pine Editor screenshot ── */

const GOLDEN = `//@version=5
indicator("SMA 150/200/300/400", overlay=true)
sma150 = ta.sma(close, 150)
sma200 = ta.sma(close, 200)
sma300 = ta.sma(close, 300)
sma400 = ta.sma(close, 400)
plot(sma150, "SMA 150", color=color.new(#00BFFF, 0))  // light blue
plot(sma200, "SMA 200", color=color.new(#722F37, 0))  // dark wine red
plot(sma300, "SMA 300", color=color.new(#FFFFFF, 0))  // white
plot(sma400, "SMA 400", color=color.new(#FF69B4, 0))  // pink`;

{
  const r = pineRun(GOLDEN, bars);
  assert.equal(r.title, 'SMA 150/200/300/400', 'indicator() title');
  assert.equal(r.overlay, true, 'overlay=true → main pane');
  assert.equal(r.plots.length, 4, 'four plot() calls → four plots');
  // Arrays built inside the vm have that realm's Array.prototype, which deepStrictEqual
  // treats as a different type. Compare structurally via JSON instead of by reference.
  assert.deepEqual(
    JSON.parse(JSON.stringify(r.plots.map((p) => p.title))),
    ['SMA 150', 'SMA 200', 'SMA 300', 'SMA 400'],
  );

  // color.new(#RRGGBB, 0) → fully opaque rgba
  assert.equal(r.plots[0].color, 'rgba(0,191,255,1.000)', 'light blue');
  assert.equal(r.plots[1].color, 'rgba(114,47,55,1.000)', 'dark wine red');
  assert.equal(r.plots[2].color, 'rgba(255,255,255,1.000)', 'white');
  assert.equal(r.plots[3].color, 'rgba(255,105,180,1.000)', 'pink');

  // Every plot is 1:1 with the bars — a length mismatch would shift the line on the chart.
  for (const p of r.plots) assert.equal(p.data.length, bars.length, `${p.title} aligned to bars`);

  // Values match a reference SMA, and the warm-up region is na (null), not 0.
  const ref150 = refSma(closes, 150);
  const got = r.plots[0].data;
  assert.equal(got[148], null, 'SMA 150 is na before bar 150');
  assert.ok(got[149] != null, 'SMA 150 defined at bar 150');
  for (let i = 0; i < bars.length; i++) {
    if (ref150[i] == null) assert.equal(got[i], null, `bar ${i} should be na`);
    else assert.ok(approx(got[i], ref150[i]), `SMA 150 at bar ${i}: ${got[i]} vs ${ref150[i]}`);
  }
  // Longest MA warms up last.
  assert.equal(r.plots[3].data[398], null, 'SMA 400 still na at bar 399 (only 400 bars)');
}
console.log('✓ golden: the 4-SMA script from the Pine Editor screenshot');

/* ── 2. overlay=false routes to a sub-pane ── */
{
  const r = pineRun(`//@version=5
indicator("RSI", overlay=false)
plot(ta.rsi(close, 14), "RSI", color=color.purple)`, bars);
  assert.equal(r.overlay, false, 'overlay=false → sub-pane');
  const rsi = r.plots[0].data;
  const defined = rsi.filter((v) => v != null);
  assert.ok(defined.length > 300, 'RSI produces values');
  for (const v of defined) assert.ok(v >= 0 && v <= 100, `RSI in [0,100], got ${v}`);
}
console.log('✓ overlay=false → sub-pane; RSI stays within 0..100');

/* ── 3. ta.* honors its source argument (regression) ──
   The engine's rsiCalc/wmaCalc take a bar-field name, so a naive binding computed every
   ta.* on `close` regardless of the argument passed. ta.sma(high) must differ from
   ta.sma(close) — and equal a reference SMA over the highs. */
{
  const r = pineRun(`//@version=5
indicator("src", overlay=true)
plot(ta.sma(high, 20), "H")
plot(ta.sma(close, 20), "C")
plot(ta.sma(volume, 20), "V")`, bars);
  const [h, c, v] = r.plots.map((p) => p.data);
  const refHigh = refSma(bars.map((b) => b.high), 20);
  const refVol = refSma(bars.map((b) => b.volume), 20);
  assert.ok(approx(h[300], refHigh[300]), 'ta.sma(high) uses highs');
  assert.ok(approx(v[300], refVol[300]), 'ta.sma(volume) uses volume');
  assert.ok(!approx(h[300], c[300]), 'ta.sma(high) !== ta.sma(close)');
}
console.log('✓ ta.* respects its source argument (high / close / volume differ)');

/* ── 4. ta.atr aligns by time, not index (regression) ──
   atrCalc() SKIPS its warm-up bars (returns a short {time,value}[] starting at len-1).
   Indexing that array directly would shift ATR left by len-1 bars — every value landing on
   the wrong candle. The interpreter re-aligns by time; assert the warm-up is na. */
{
  const r = pineRun(`//@version=5
indicator("atr", overlay=false)
plot(ta.atr(14), "ATR")`, bars);
  const atr = r.plots[0].data;
  assert.equal(atr.length, bars.length, 'ATR spans every bar');
  assert.equal(atr[0], null, 'ATR is na on bar 0 (warm-up), not the first computed value');
  assert.equal(atr[12], null, 'ATR still na at bar 12');
  assert.ok(atr[13] != null, 'ATR defined from bar 13 (len=14)');
  // True range here is bounded well under 20; a left-shifted array would still look
  // "reasonable", so pin the actual value against an independent TR/RMA computation.
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)));
  let prev = tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  const ref = new Array(bars.length).fill(null);
  ref[13] = prev;
  for (let i = 14; i < bars.length; i++) { prev = (prev * 13 + tr[i]) / 14; ref[i] = prev; }
  assert.ok(approx(atr[13], ref[13], 1e-6), `ATR[13] ${atr[13]} vs ${ref[13]}`);
  assert.ok(approx(atr[200], ref[200], 1e-6), `ATR[200] ${atr[200]} vs ${ref[200]}`);
}
console.log('✓ ta.atr is time-aligned — warm-up bars are na, values land on the right candle');

/* ── 5. Series arithmetic broadcasts element-wise; na propagates ── */
{
  const r = pineRun(`//@version=5
indicator("math", overlay=true)
basis = ta.sma(close, 20)
dev = ta.stdev(close, 20) * 2
plot(basis + dev, "Upper")
plot(basis - dev, "Lower")
plot(close * 2 - 100, "Scaled")`, bars);
  const [up, lo, scaled] = r.plots.map((p) => p.data);
  assert.equal(up[10], null, 'na propagates through series arithmetic during warm-up');
  assert.ok(up[100] > lo[100], 'upper band above lower band');
  assert.ok(approx(scaled[100], bars[100].close * 2 - 100), 'scalar broadcast over a series');
}
console.log('✓ series arithmetic broadcasts scalars and propagates na');

/* ── 6. History access, ternary, crossover ── */
{
  const r = pineRun(`//@version=5
indicator("hist", overlay=true)
prev = close[1]
up = close > close[1] ? high : low
plot(prev, "Prev close")
plot(up, "Cond")`, bars);
  const [prev, cond] = r.plots.map((p) => p.data);
  assert.equal(prev[0], null, 'close[1] is na on the first bar');
  assert.ok(approx(prev[50], bars[49].close), 'close[1] is the previous bar');
  const expect = bars[50].close > bars[49].close ? bars[50].high : bars[50].low;
  assert.ok(approx(cond[50], expect), 'ternary selects per bar');
}
console.log('✓ series[n] history and per-bar ternary');

/* ── 7. Errors are reported with a line number, not a silent failure ── */
{
  // unknown variable
  assert.throws(
    () => pineRun('//@version=5\nindicator("x")\nplot(nonsense)', bars),
    (e) => e.message.includes('nonsense') && e.line === 3,
    'unknown variable names the symbol and its line',
  );
  // unsupported function
  assert.throws(
    () => pineRun('//@version=5\nindicator("x")\nplot(ta.supertrend(close, 3))', bars),
    (e) => /not supported|Unknown function/.test(e.message) && e.line === 3,
    'unsupported ta.* function is a clear error',
  );
  // no plot at all
  assert.throws(
    () => pineRun('//@version=5\nindicator("x")\nfoo = ta.sma(close, 5)', bars),
    (e) => /no plot/.test(e.message),
    'a script that plots nothing is an error, not an empty indicator',
  );
  // syntax error
  assert.throws(() => pineRun('//@version=5\nindicator("x"\nplot(close)', bars), /Expected|Unexpected/);
  // no data loaded
  assert.throws(() => pineRun(GOLDEN, []), /No chart data/);
}
console.log('✓ errors carry a message + line number (unknown var, bad fn, no plot, syntax, no data)');

/* ── 8. Comments and strings don't confuse the tokenizer ── */
{
  const r = pineRun(`//@version=5
indicator("A // not a comment", overlay=true)   // this one is
plot(close, "Close // still a title")  // trailing`, bars);
  assert.equal(r.title, 'A // not a comment', '// inside a string is not a comment');
  assert.equal(r.plots[0].title, 'Close // still a title');
}
console.log('✓ // inside string literals is not treated as a comment');

/* ── 9. input.* returns its default and is collected ── */
{
  const r = pineRun(`//@version=5
indicator("in", overlay=true)
len = input.int(30, "Length")
plot(ta.sma(close, len), "MA")`, bars);
  assert.equal(r.inputs.length, 1, 'one input declared');
  assert.equal(String(r.inputs[0].name), 'Length', 'input title');
  assert.equal(r.inputs[0].value, 30, 'input.int default collected');
  const ref = refSma(closes, 30);
  assert.ok(approx(r.plots[0].data[100], ref[100]), 'the input value actually drives ta.sma');
}
console.log('✓ input.int supplies its default to the script');

console.log('\nAll Pine interpreter tests passed.');
