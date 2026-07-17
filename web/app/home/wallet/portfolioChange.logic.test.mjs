// Pure-logic tests for the portfolio header's 24h change anchor.
//
// The trap this pins down: the reference design we copied the header from reads "24h: +$63,654.40"
// on a portfolio worth exactly $63,654.40 — it differences a brand-new wallet against zero and
// reports the entire opening balance as a day's gain. valueAgo must return null in that case so the
// header renders "—" instead of a fabricated windfall.
//
// The logic mirrors valueAgo in holdings.ts (which is TS; this file follows the repo's existing
// *.logic.test.mjs convention of restating the function so it runs under bare node).
//
// Run: node app/home/wallet/portfolioChange.logic.test.mjs

import assert from 'node:assert/strict';

/* ── The logic under test (mirrors valueAgo in holdings.ts) ── */

const CHANGE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

function valueAgo(snapshots, hoursAgo, now) {
  if (snapshots.length === 0) return null;
  const target = now - hoursAgo * 3600_000;
  let anchor = null;
  for (const s of snapshots) {
    if (s.t <= target) anchor = s;
    else break;
  }
  if (!anchor) return null;
  if (target - anchor.t > CHANGE_TOLERANCE_MS) return null;
  return anchor.value;
}

const HOUR = 3600_000;
const NOW = 1_700_000_000_000; // fixed clock — no Date.now() in assertions
const at = (hoursAgo, value) => ({ t: NOW - hoursAgo * HOUR, value });

/* ── No history reaches back 24h → no number ── */

// The reported case: asset added moments ago, one snapshot on the books.
assert.equal(valueAgo([at(0, 63_654.4)], 24, NOW), null, 'fresh portfolio has no 24h anchor');
assert.equal(valueAgo([], 24, NOW), null, 'empty history has no anchor');

// Several hours of history is still not a day of it.
assert.equal(
  valueAgo([at(6, 1000), at(3, 1100), at(0, 1200)], 24, NOW),
  null,
  '6h of snapshots must not answer a 24h question',
);

// Guards the actual regression: differencing against the oldest snapshot would report +$63,654.40
// (the whole balance) as a 24h gain. Prove we return null rather than the first reading.
const dayOne = [at(0.5, 63_654.4)];
assert.equal(valueAgo(dayOne, 24, NOW), null);
assert.notEqual(valueAgo(dayOne, 24, NOW), 0, 'must not anchor to zero');
assert.notEqual(valueAgo(dayOne, 24, NOW), 63_654.4, 'must not anchor to the opening balance');

/* ── History that does reach back → the value at that point ── */

const week = [at(72, 800), at(25, 1000), at(24, 1001), at(12, 1100), at(0, 1200)];
assert.equal(valueAgo(week, 24, NOW), 1001, 'picks the last snapshot at/before the 24h mark');

// Exactly on the boundary counts (t <= target).
assert.equal(valueAgo([at(24, 900), at(0, 1000)], 24, NOW), 900, 'boundary snapshot is eligible');

// A longer window reaches a further-back anchor.
assert.equal(valueAgo(week, 72, NOW), 800, '72h window anchors to the 72h snapshot');

/* ── Stale history → no number, rather than a mislabelled one ── */

// Portfolio untouched for a week: the nearest pre-24h snapshot is 7 days old. Calling that "24h"
// would date the change by six days, so it reads as no data.
assert.equal(
  valueAgo([at(168, 500), at(0, 1200)], 24, NOW),
  null,
  'anchor far outside the window is not a 24h reading',
);

// Just inside the tolerance still answers — a 5-min snapshot cadence has real gaps.
assert.equal(
  valueAgo([at(25.5, 950), at(0, 1200)], 24, NOW),
  950,
  'anchor within tolerance of the target is usable',
);

/* ── The delta the header renders on top of the anchor ── */

const pctChange = (from, to) => ((to - from) / from) * 100;
assert.equal(pctChange(1001, 1200).toFixed(2), '19.88', '24h delta computes off the anchor');
assert.equal(pctChange(1200, 1001).toFixed(2), '-16.58', 'losses read negative');

console.log('portfolioChange.logic.test.mjs: all assertions passed');
