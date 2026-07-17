// Pure-logic tests for the Reports quality gate (see gate.ts).
//
// THE BUG THIS PREVENTS — observed on a live CMC pull while designing this feature:
//
//   Ranking the raw 500-coin pool by 30d percent change put these in the top slots:
//     ANSEM     +152,296.9%   — near-zero baseline, a sub-tick price move reads as five figures
//     CASHCAT     +8,485.9%   — same shape
//     U           +1,289.3%
//
//   None of those are opportunities; they're dead microcaps and listing artifacts. A monthly report
//   led by them is worse than no report, because the LLM then writes confident prose explaining a
//   1,500x that never economically happened. The stated goal is catching assets AS THEY START to
//   move — the exact opposite of coins that already printed their whole move.
//
// So: the gate must reject them, and must keep a real mid-cap mover in the same pool.
//
// Run: node web/app/api/reports/_lib/gate.logic.test.mjs

import assert from 'node:assert/strict';

const { gateAndRank, MIN_MARKET_CAP, MIN_VOLUME_24H, MAX_CMC_RANK, MAX_ABS_CHANGE_PCT } =
  await import('./gate.ts');

/** Build a Coin with sane defaults; override only what a case is about. */
const coin = (over = {}) => ({
  id: 1,
  cmcRank: 100,
  symbol: 'OK',
  name: 'Fine Coin',
  slug: 'fine-coin',
  price: 1,
  change1h: 0,
  change24h: 5,
  change7d: 5,
  change30d: 5,
  volume: 50_000_000,
  marketCap: 500_000_000,
  circulatingSupply: null,
  maxSupply: null,
  thumb: '',
  sparkline7d: [],
  ...over,
});

/* ── 1. The real-world regression: the actual coins from the live pull must not appear ── */
{
  const pool = [
    // Values and shapes taken from the live CMC pull, not invented.
    coin({ id: 9001, symbol: 'ANSEM', change30d: 152_296.9, marketCap: 2_000_000, volume: 1_200_000, cmcRank: 4800 }),
    coin({ id: 9002, symbol: 'CASHCAT', change30d: 8_485.9, marketCap: 5_000_000, volume: 2_000_000, cmcRank: 3900 }),
    coin({ id: 9003, symbol: 'REAL', change30d: 42.5, marketCap: 800_000_000, volume: 90_000_000, cmcRank: 60 }),
  ];
  const out = gateAndRank(pool, 'monthly');
  const symbols = out.map((c) => c.symbol);

  assert.ok(!symbols.includes('ANSEM'), 'ANSEM (+152,296%) must be gated out of the monthly report');
  assert.ok(!symbols.includes('CASHCAT'), 'CASHCAT (+8,486%) must be gated out');
  assert.deepEqual(symbols, ['REAL'], 'only the real, liquid mover survives');
}

/* ── 2. Each threshold rejects independently ── */
{
  const base = { change24h: 30, cmcRank: 50 };
  const cases = [
    ['market cap below floor', { ...base, marketCap: MIN_MARKET_CAP - 1 }],
    ['volume below floor', { ...base, volume: MIN_VOLUME_24H - 1 }],
    ['rank beyond cap', { ...base, cmcRank: MAX_CMC_RANK + 1 }],
    ['change above ceiling', { ...base, change24h: MAX_ABS_CHANGE_PCT + 1 }],
    ['null change', { ...base, change24h: null }],
    ['null market cap', { ...base, marketCap: null }],
    ['null volume', { ...base, volume: null }],
    ['null rank', { ...base, cmcRank: null }],
  ];
  for (const [label, over] of cases) {
    assert.equal(gateAndRank([coin(over)], 'daily').length, 0, `must reject: ${label}`);
  }
  // Boundaries are exclusive on the floors, inclusive on the ceiling.
  assert.equal(gateAndRank([coin({ ...base, marketCap: MIN_MARKET_CAP })], 'daily').length, 0,
    'market cap exactly at the floor is rejected (strictly greater required)');
  assert.equal(gateAndRank([coin({ ...base, cmcRank: MAX_CMC_RANK })], 'daily').length, 1,
    'rank exactly at the cap is kept');
  assert.equal(gateAndRank([coin({ ...base, change24h: MAX_ABS_CHANGE_PCT })], 'daily').length, 1,
    'change exactly at the ceiling is kept');
}

/* ── 3. It's a GAINERS report — losers and flat coins never appear ── */
{
  const pool = [coin({ symbol: 'DOWN', change24h: -30 }), coin({ symbol: 'FLAT', change24h: 0 }), coin({ symbol: 'UP', change24h: 12 })];
  assert.deepEqual(gateAndRank(pool, 'daily').map((c) => c.symbol), ['UP']);
}

/* ── 4. Ranking is by the PERIOD's change field, not always 24h ── */
{
  const pool = [
    coin({ id: 1, symbol: 'DAYWIN', change24h: 90, change7d: 1, change30d: 1 }),
    coin({ id: 2, symbol: 'WEEKWIN', change24h: 1, change7d: 90, change30d: 1 }),
    coin({ id: 3, symbol: 'MONTHWIN', change24h: 1, change7d: 1, change30d: 90 }),
  ];
  assert.equal(gateAndRank(pool, 'daily')[0].symbol, 'DAYWIN');
  assert.equal(gateAndRank(pool, 'weekly')[0].symbol, 'WEEKWIN');
  assert.equal(gateAndRank(pool, 'monthly')[0].symbol, 'MONTHWIN');
  // changePct must carry the period's number, not the 24h one.
  assert.equal(gateAndRank(pool, 'weekly')[0].changePct, 90);
}

/* ── 5. Sorted descending and capped at topN ── */
{
  const pool = Array.from({ length: 40 }, (_, i) => coin({ id: i, symbol: `C${i}`, change24h: i + 1 }));
  const out = gateAndRank(pool, 'daily');
  assert.equal(out.length, 20, 'caps at TOP_N');
  assert.equal(out[0].symbol, 'C39', 'highest change first');
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].changePct >= out[i].changePct, 'strictly descending');
  }
}

/* ── 6. turnover is volume/marketCap and never divides by zero (mcap floor guarantees it) ── */
{
  const [c] = gateAndRank([coin({ volume: 50_000_000, marketCap: 500_000_000 })], 'daily');
  assert.equal(c.turnover, 0.1);
}

console.log('gate.logic.test.mjs — all assertions passed');
