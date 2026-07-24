// Pure-logic tests for the portfolio history chart's series builder.
//
// The bug: PortfolioHistory in WalletViewWeb.tsx builds its chart series ONLY from locally
// recorded snapshots:
//
//   const cutoff = period.hours ? Date.now() - period.hours * 3600_000 : 0;
//   const inRange = snapshots.filter((s) => s.t >= cutoff);
//   const data = liveValue > 0 ? [...inRange, { t: Date.now(), value: liveValue }] : inRange;
//
// recordSnapshot() only writes a point every 5 minutes WHILE THE APP IS OPEN. So selecting "24h"
// shows only the minutes since page load — e.g. snapshots from 1:47 PM to 2:13 PM — not the actual
// last 24 hours of portfolio movement. Cursor hover can only land on those few snapshot timestamps.
//
// The fix: buildPortfolioSeries() derives the series from market kline history (per-holding price
// series) instead, so the chart spans the whole selected period regardless of how long the app has
// been open.
//
// This mirrors buildSeries (current/buggy) from WalletViewWeb.tsx and buildPortfolioSeries
// (intended fix), following the repo's *.logic.test.mjs convention of restating the function so it
// runs under bare node rather than importing TS.
//
// Run: node app/home/wallet/portfolioSeries.logic.test.mjs

import assert from 'node:assert/strict';

/* ── buildSeries: mirrors CURRENT (buggy) behaviour in WalletViewWeb.tsx PortfolioHistory ── */
//
//   const cutoff = period.hours ? Date.now() - period.hours * 3600_000 : 0;
//   const inRange = snapshots.filter((s) => s.t >= cutoff);
//   const data = liveValue > 0 ? [...inRange, { t: Date.now(), value: liveValue }] : inRange;

function buildSeries(snapshots, liveValue, now, opts = {}) {
  const hours = opts.hours ?? null;
  const cutoff = hours ? now - hours * 3600_000 : 0;
  const inRange = snapshots.filter((s) => s.t >= cutoff);
  return liveValue > 0 ? [...inRange, { t: now, value: liveValue }] : inRange;
}

/* ── buildPortfolioSeries: intended fix ── */
//
// buildPortfolioSeries(holdings, seriesBySymbol, livePrices, cutoff, now, liveValue)
//  holdings:       [{ symbol, amount }]
//  seriesBySymbol: { SYM: [{ t, close }, ...] }  (ascending t; may be missing/empty per symbol)
//  livePrices:     { SYM: number }               (current price; used flat for symbols with no series)
//  cutoff:         epoch ms lower bound (0 = unbounded / "All")
//  now:            epoch ms
//  liveValue:      current portfolio total; appended as a final { t: now, value } point when > 0
// Returns [{ t, value }] or [] when no usable market history exists.
//
// Rules:
// 1. Grid = the in-range ([cutoff, now]) timestamps of whichever symbol's series has the MOST
//    in-range points. If no series has >= 2 in-range points, return [] (caller falls back to
//    snapshots).
// 2. A holding's price at grid time t = close of its last point with pt.t <= t; if t precedes
//    its first point, the first point's close (flat backfill).
// 3. A holding with no series entry (or an empty one) contributes amount * (livePrices[sym] ?? 0),
//    flat across the grid.
// 4. value(t) = sum over holdings of amount * price_at(t).
// 5. Append { t: now, value: liveValue } when liveValue > 0 and now > last grid timestamp.

function priceAt(series, t) {
  // series is ascending by t; find close of last point with pt.t <= t, else first point's close.
  let result = series[0].close;
  for (const pt of series) {
    if (pt.t <= t) result = pt.close;
    else break;
  }
  return result;
}

function buildPortfolioSeries(holdings, seriesBySymbol, livePrices, cutoff, now, liveValue) {
  // 1. Choose the grid: the in-range timestamps of the symbol with the most in-range points.
  let grid = [];
  for (const { symbol } of holdings) {
    const series = seriesBySymbol[symbol];
    if (!series || series.length === 0) continue;
    const inRange = series.filter((pt) => pt.t >= cutoff && pt.t <= now).map((pt) => pt.t);
    if (inRange.length > grid.length) grid = inRange;
  }
  if (grid.length < 2) return [];

  // 2–4. Compute value(t) for each grid timestamp.
  const points = grid.map((t) => {
    let value = 0;
    for (const { symbol, amount } of holdings) {
      const series = seriesBySymbol[symbol];
      if (series && series.length > 0) {
        value += amount * priceAt(series, t);
      } else {
        value += amount * (livePrices[symbol] ?? 0);
      }
    }
    return { t, value };
  });

  // 5. Append the live point.
  const last = points[points.length - 1];
  if (liveValue > 0 && now > last.t) {
    points.push({ t: now, value: liveValue });
  }

  return points;
}

/* ── fixtures ── */

const NOW = 1_800_000_000_000; // fixed clock — no Date.now() in assertions
const MIN = 60_000;
const HOUR = 3600_000;

/* ── 1. Bug repro: buildSeries shows only the last ~26 minutes for a 24h window ── */

{
  // App was opened ~26 minutes ago; recordSnapshot() has only written points every 5 min since then.
  const recentSnapshots = [];
  for (let i = 26; i >= 0; i -= 5) {
    recentSnapshots.push({ t: NOW - i * MIN, value: 63_000 + i * 2 });
  }

  const data = buildSeries(recentSnapshots, 63_050, NOW, { hours: 24 });

  const first = data[0];
  const THIRTY_MIN_AGO = NOW - 30 * MIN;
  assert.ok(
    first.t > THIRTY_MIN_AGO,
    `bug reproduced: first point (t=${first.t}) is after now-30min (${THIRTY_MIN_AGO}) — ` +
      `24h view cannot show the day's movement, only the minutes since page load`,
  );
  assert.ok(
    data.length < 10,
    `bug reproduced: only ${data.length} points exist — cursor hover has almost no positions to land on`,
  );
}

/* ── 2. Fix: full-range coverage — 24h of 15-min BTC klines spans from cutoff to now ── */

{
  const cutoff = NOW - 24 * HOUR;
  const btcSeries = [];
  for (let t = cutoff; t <= NOW; t += 15 * MIN) {
    btcSeries.push({ t, close: 60_000 + (t - cutoff) / 1_000_000 }); // gentle upward drift
  }
  assert.equal(btcSeries.length, 97, 'sanity: 24h at 15-min spacing yields 97 points inclusive');

  const holdings = [
    { symbol: 'BTC', amount: 0.5 },
    { symbol: 'XYZ', amount: 100 },
  ];
  const seriesBySymbol = { BTC: btcSeries };
  const livePrices = { XYZ: 2 };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, livePrices, cutoff, NOW, 0);

  assert.ok(data.length >= 96, `expected ~96+ points, got ${data.length} — hover can land on every period`);
  const twentyMin = 20 * MIN;
  assert.ok(
    Math.abs(data[0].t - cutoff) <= twentyMin,
    `first point (t=${data[0].t}) should be within 20 min of cutoff (${cutoff})`,
  );

  // Spot-check value(t) = 0.5 * BTC close + 100 * 2 (XYZ has no series, flat live price).
  const firstBtc = btcSeries[0].close;
  assert.equal(data[0].value, 0.5 * firstBtc + 100 * 2, 'first grid point value = BTC contribution + flat XYZ');
}

/* ── 3. Fix: grid choice — dense series (96 pts) wins over sparse series (4 pts) ── */

{
  const cutoff = NOW - 24 * HOUR;
  const denseSeries = [];
  for (let t = cutoff; t <= NOW; t += 15 * MIN) denseSeries.push({ t, close: 100 });
  const sparseSeries = [
    { t: cutoff, close: 10 },
    { t: cutoff + 8 * HOUR, close: 11 },
    { t: cutoff + 16 * HOUR, close: 12 },
    { t: NOW, close: 13 },
  ];

  const holdings = [
    { symbol: 'DENSE', amount: 1 },
    { symbol: 'SPARSE', amount: 1 },
  ];
  const seriesBySymbol = { DENSE: denseSeries, SPARSE: sparseSeries };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, {}, cutoff, NOW, 0);

  assert.equal(data.length, denseSeries.length, 'grid length matches the dense series, not the sparse one');
}

/* ── 4. Fix: step interpolation — sparse holding takes last point <= t, flat-backfills before first ── */

{
  const cutoff = NOW - 24 * HOUR;
  const denseSeries = [];
  for (let t = cutoff; t <= NOW; t += 6 * HOUR) denseSeries.push({ t, close: 100 }); // provides the grid
  const sparseSeries = [
    { t: cutoff + 3 * HOUR, close: 50 }, // starts AFTER the grid's first timestamp
    { t: cutoff + 15 * HOUR, close: 80 },
  ];

  const holdings = [
    { symbol: 'GRID', amount: 1 },
    { symbol: 'SPARSE', amount: 1 },
  ];
  const seriesBySymbol = { GRID: denseSeries, SPARSE: sparseSeries };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, {}, cutoff, NOW, 0);

  // Grid timestamps: cutoff, cutoff+6h, cutoff+12h, cutoff+18h, cutoff+24h(=NOW).
  // At cutoff (before sparse's first point at cutoff+3h) → flat-backfill to 50.
  const atCutoff = data.find((p) => p.t === cutoff);
  assert.equal(atCutoff.value, 100 + 50, 'before first sparse point: flat-backfills to first close (50)');

  // At cutoff+12h: between sparse points (cutoff+3h @50) and (cutoff+15h @80) → takes the earlier one (50).
  const midT = cutoff + 12 * HOUR;
  const atMid = data.find((p) => p.t === midT);
  assert.ok(atMid, 'grid includes cutoff+12h');
  assert.equal(atMid.value, 100 + 50, 'between sparse points: takes value of last point <= t (50)');

  // At cutoff+18h: past the sparse point at cutoff+15h @80 → takes 80.
  const lateT = cutoff + 18 * HOUR;
  const atLate = data.find((p) => p.t === lateT);
  assert.ok(atLate, 'grid includes cutoff+18h');
  assert.equal(atLate.value, 100 + 80, 'after last sparse point <= t: takes its close (80)');
}

/* ── 5. Fix: missing-series holding uses livePrices flat; symbol absent from livePrices contributes 0 ── */

{
  const cutoff = NOW - 2 * HOUR;
  const gridSeries = [
    { t: cutoff, close: 100 },
    { t: cutoff + HOUR, close: 110 },
    { t: NOW, close: 120 },
  ];

  const holdings = [
    { symbol: 'GRID', amount: 1 },
    { symbol: 'NOSERIES', amount: 10 }, // has a livePrices entry
    { symbol: 'UNKNOWN', amount: 5 }, // absent from livePrices entirely
  ];
  const seriesBySymbol = { GRID: gridSeries };
  const livePrices = { NOSERIES: 3 };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, livePrices, cutoff, NOW, 0);

  for (const pt of data) {
    const grid = gridSeries.find((g) => g.t === pt.t);
    assert.equal(pt.value, grid.close * 1 + 10 * 3 + 5 * 0, `t=${pt.t}: NOSERIES flat at 3, UNKNOWN contributes 0`);
  }
}

/* ── 6. Fix: returns [] when no series has >= 2 in-range points (all-empty seriesBySymbol) ── */

{
  const cutoff = NOW - 24 * HOUR;
  const holdings = [
    { symbol: 'A', amount: 1 },
    { symbol: 'B', amount: 2 },
  ];
  const seriesBySymbol = { A: [], B: [] };
  const livePrices = { A: 10, B: 20 };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, livePrices, cutoff, NOW, 12_345);
  assert.deepEqual(data, [], 'no usable market history → [] so caller falls back to snapshots');
}

{
  // Also covers: a symbol with only 1 in-range point (can't form a grid) and no seriesBySymbol entries at all.
  const cutoff = NOW - 24 * HOUR;
  const holdings = [{ symbol: 'A', amount: 1 }];
  const seriesBySymbol = { A: [{ t: NOW, close: 10 }] }; // only 1 in-range point
  const data = buildPortfolioSeries(holdings, seriesBySymbol, {}, cutoff, NOW, 0);
  assert.deepEqual(data, [], 'a single in-range point cannot form a grid → []');
}

/* ── 7. Fix: live point appended at t=now with value=liveValue when liveValue > 0 ── */

{
  const cutoff = NOW - 2 * HOUR;
  const gridSeries = [
    { t: cutoff, close: 100 },
    { t: cutoff + HOUR, close: 110 },
    { t: NOW - 10 * MIN, close: 115 }, // last grid point is before `now`
  ];
  const holdings = [{ symbol: 'A', amount: 1 }];
  const seriesBySymbol = { A: gridSeries };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, {}, cutoff, NOW, 999);

  assert.equal(data.length, gridSeries.length + 1, 'live point appended as an extra point');
  const last = data[data.length - 1];
  assert.equal(last.t, NOW, 'live point stamped at now');
  assert.equal(last.value, 999, 'live point uses liveValue verbatim');
}

/* ── 8. Fix: live point NOT appended when liveValue is 0 ── */

{
  const cutoff = NOW - 2 * HOUR;
  const gridSeries = [
    { t: cutoff, close: 100 },
    { t: cutoff + HOUR, close: 110 },
    { t: NOW - 10 * MIN, close: 115 },
  ];
  const holdings = [{ symbol: 'A', amount: 1 }];
  const seriesBySymbol = { A: gridSeries };

  const data = buildPortfolioSeries(holdings, seriesBySymbol, {}, cutoff, NOW, 0);

  assert.equal(data.length, gridSeries.length, 'no live point appended when liveValue is 0');
  assert.notEqual(data[data.length - 1].t, NOW, 'last point is not stamped at now');
}

console.log('portfolioSeries.logic.test.mjs: all assertions passed');
