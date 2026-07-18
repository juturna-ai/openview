// Pure-logic tests for the portfolio history chart's data-series builder.
//
// The bug: ValueChart in WalletView.tsx builds its series as
//   const data = liveValue > 0 ? [...inRange, { t: Date.now(), value: liveValue }] : inRange;
// This ALWAYS appends a live point at Date.now(), even when liveValue has drifted far from the
// last snapshot's value — which happens right after the user adds/removes a holding or switches
// portfolios (the stored snapshots still reflect a DIFFERENT total). The appended point then sits
// far above/below the last real snapshot, drawing a near-vertical spike at the chart's right edge.
// Reported case: snapshots around $63k, live point jumps to $92k.
//
// This mirrors buildSeries (current/buggy) and buildSeriesFixed (intended fix) from the logic in
// WalletView.tsx, following the repo's *.logic.test.mjs convention of restating the function so it
// runs under bare node rather than importing TS.
//
// Run: node app/home/wallet/chartSeries.logic.test.mjs

import assert from 'node:assert/strict';

/* ── buildSeries: mirrors CURRENT (buggy) behaviour in WalletView.tsx ── */
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

/* ── buildSeriesFixed: intended fix ── */
//
// Only append the live point when:
//   1. There IS a last snapshot to compare against sanely (or no snapshots at all — then the live
//      point is the only data we have, so always include it).
//   2. The last snapshot is at least MIN_LIVE_POINT_AGE_MS old — otherwise the live point is
//      redundant (it would sit right on top of the last snapshot anyway).
//   3. liveValue is within MAX_LIVE_DELTA_FRACTION of the last snapshot's value — otherwise the
//      snapshot history is considered stale (belongs to a different portfolio state) and we stop
//      the line at the last real snapshot instead of spiking to the live value.

const MIN_LIVE_POINT_AGE_MS = 60_000; // 60s — don't bother appending a live point this soon after a snapshot
const MAX_LIVE_DELTA_FRACTION = 0.2; // 20% — beyond this, treat snapshots as stale/from a different portfolio

// A >20% step between consecutive snapshots means the portfolio composition changed (a holding was
// added/removed, or portfolios were switched) — the recorded total jumps even though no price moved.
// The history before that jump belongs to a different portfolio, so keep only the run after the LAST
// such jump. This is the real spike source: recordSnapshot() writes a fresh, far-off total on the
// first poll after the change, so the spike lives in the stored data, not just the live point.
const MAX_JUMP_FRACTION = 0.2;

function trimToCurrentPortfolio(inRange) {
  let start = 0;
  for (let i = 1; i < inRange.length; i++) {
    const prev = inRange[i - 1].value;
    if (prev > 0 && Math.abs(inRange[i].value - prev) / prev > MAX_JUMP_FRACTION) start = i;
  }
  return start > 0 ? inRange.slice(start) : inRange;
}

function buildSeriesFixed(snapshots, liveValue, now, opts = {}) {
  const hours = opts.hours ?? null;
  const minLivePointAgeMs = opts.minLivePointAgeMs ?? MIN_LIVE_POINT_AGE_MS;
  const maxLiveDeltaFraction = opts.maxLiveDeltaFraction ?? MAX_LIVE_DELTA_FRACTION;

  const cutoff = hours ? now - hours * 3600_000 : 0;
  const inRange = trimToCurrentPortfolio(snapshots.filter((s) => s.t >= cutoff));

  if (!(liveValue > 0)) return inRange;

  const last = inRange[inRange.length - 1];
  if (!last) return [...inRange, { t: now, value: liveValue }];

  const ageMs = now - last.t;
  if (ageMs < minLivePointAgeMs) return inRange;

  const deltaFraction = Math.abs(liveValue - last.value) / last.value;
  if (deltaFraction > maxLiveDeltaFraction) return inRange;

  return [...inRange, { t: now, value: liveValue }];
}

/* ── fixtures ── */

const NOW = 1_700_000_000_000; // fixed clock — no Date.now() in assertions
const MIN = 60_000;

const snapshots63k = [
  { t: NOW - 3 * 3600_000, value: 62_800 },
  { t: NOW - 2 * 3600_000, value: 63_100 },
  { t: NOW - 5 * MIN, value: 63_654.4 }, // last snapshot, 5 min old
];

/* ── 1. Bug repro: buildSeries produces a spike when live value has drifted far (63k → 92k) ── */

{
  const data = buildSeries(snapshots63k, 92_000, NOW);
  assert.equal(data.length, snapshots63k.length + 1, 'live point appended');
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  assert.equal(last.t, NOW, 'live point is stamped at now');
  assert.equal(last.value, 92_000);
  assert.equal(prev.value, 63_654.4, 'previous point is the last real snapshot');

  const gap = Math.abs(last.value - prev.value);
  const SPIKE_THRESHOLD = 5_000; // absolute $ gap that reads as a visible vertical spike on this chart
  assert.ok(gap > SPIKE_THRESHOLD, `expected a spike (gap ${gap} > ${SPIKE_THRESHOLD}) — bug reproduced`);
}

/* ── 2. Bug repro: even a "normal" drift with a very fresh snapshot still spikes today ── */

{
  // Last snapshot is only 5s old; buggy code still appends a duplicate-ish live point on top.
  const freshSnapshots = [
    { t: NOW - 3 * 3600_000, value: 62_800 },
    { t: NOW - 5_000, value: 63_654.4 },
  ];
  const data = buildSeries(freshSnapshots, 63_700, NOW);
  assert.equal(data.length, freshSnapshots.length + 1, 'buggy code appends regardless of snapshot freshness');
}

/* ── 3. Fix: no spike for the 63k → 92k case — line ends at the last real snapshot ── */

{
  const data = buildSeriesFixed(snapshots63k, 92_000, NOW);
  assert.equal(data.length, snapshots63k.length, 'fixed series does not append the drifted live point');
  const last = data[data.length - 1];
  assert.equal(last.value, 63_654.4, 'series ends at the last real snapshot, no spike');
  assert.notEqual(last.t, NOW, 'no point stamped at now');
}

/* ── 4. Fix: live point IS included for a normal case (63k snapshots + $63.1k live, last snapshot 5min old) ── */

{
  const data = buildSeriesFixed(snapshots63k, 63_100, NOW);
  assert.equal(data.length, snapshots63k.length + 1, 'live point appended for a sane, close-to-last-snapshot value');
  const last = data[data.length - 1];
  assert.equal(last.t, NOW);
  assert.equal(last.value, 63_100);
}

/* ── 5. Fix: live point is withheld when the last snapshot is too fresh (<60s), even if value matches ── */

{
  const tooFresh = [
    { t: NOW - 3 * 3600_000, value: 62_800 },
    { t: NOW - 5_000, value: 63_654.4 }, // 5s old — under the 60s floor
  ];
  const data = buildSeriesFixed(tooFresh, 63_700, NOW);
  assert.equal(data.length, tooFresh.length, 'live point withheld when last snapshot is under the min age');
}

/* ── 6. Fix: with no snapshots at all, the live point is still included (only data available) ── */

{
  const data = buildSeriesFixed([], 63_654.4, NOW);
  assert.equal(data.length, 1, 'live point included when there is no history to compare against');
  assert.equal(data[0].value, 63_654.4);
}

/* ── 7. Fix: boundary of the 20% delta threshold ── */

{
  // Exactly at 20% delta from 63,654.4 → should still be excluded (delta > threshold check uses strict >,
  // but we pick a value comfortably past 20% to avoid float-boundary flakiness).
  const justOver = 63_654.4 * 1.21; // +21%
  const dataOver = buildSeriesFixed(snapshots63k, justOver, NOW);
  assert.equal(dataOver.length, snapshots63k.length, '+21% drift excluded as stale');

  const justUnder = 63_654.4 * 1.19; // +19%
  const dataUnder = buildSeriesFixed(snapshots63k, justUnder, NOW);
  assert.equal(dataUnder.length, snapshots63k.length + 1, '+19% drift still included');
}

/* ── 8. Root cause: a recorded snapshot jump (63k for a week → 92k after adding ETH) is trimmed ── */

{
  // The exact reported case: a week of ~$63k snapshots, then recordSnapshot() writes a $92k total on
  // the first poll after ETH is added. That step is stored data, not the live point.
  const withJump = [
    { t: NOW - 6 * 3600_000, value: 63_000 },
    { t: NOW - 5 * 3600_000, value: 63_200 },
    { t: NOW - 4 * 3600_000, value: 62_900 },
    { t: NOW - 30 * MIN, value: 91_590 }, // fresh snapshot at the new total
  ];
  // Buggy path would draw all four → a vertical step from 62,900 to 91,590.
  const buggy = buildSeries(withJump, 91_600, NOW);
  const buggyGap = Math.abs(buggy[3].value - buggy[2].value);
  assert.ok(buggyGap > 5_000, 'buggy series contains the recorded spike');

  // Fixed: trim everything before the jump → only the post-change point(s) remain.
  const fixed = buildSeriesFixed(withJump, 91_600, NOW);
  assert.ok(
    fixed.every((p) => p.value > 80_000),
    'fixed series keeps only the current-portfolio run (all ~$92k), dropping the pre-jump $63k history',
  );
  // No 62,900 → 91,590 step survives.
  for (let i = 1; i < fixed.length; i++) {
    const gap = Math.abs(fixed[i].value - fixed[i - 1].value) / fixed[i - 1].value;
    assert.ok(gap <= 0.2, 'no >20% step remains in the fixed series');
  }
}

/* ── 9. A normal series with only price-sized moves is NOT trimmed ── */

{
  const smooth = [
    { t: NOW - 3 * 3600_000, value: 62_800 },
    { t: NOW - 2 * 3600_000, value: 64_000 }, // +1.9%, a normal move
    { t: NOW - 5 * MIN, value: 63_654.4 },
  ];
  const data = buildSeriesFixed(smooth, 63_700, NOW);
  assert.equal(data.length, smooth.length + 1, 'smooth history is preserved in full (+ live point)');
  assert.equal(data[0].value, 62_800, 'no trimming when there is no composition jump');
}

console.log('chartSeries.logic.test.mjs: all assertions passed');
