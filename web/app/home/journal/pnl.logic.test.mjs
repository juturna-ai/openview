// Pure-logic tests for the trade journal's realized-P&L math (trades.ts: computePnl).
//
// THE BUG: the Add-Trade modal collected a "Leverage" field but computePnl ignored it, so a
// leveraged trade's P&L reflected only the raw margin move, not the leverage-adjusted return.
// The fix treats the entered size as MARGIN and multiplies by leverage to get the notional
// exposure the P&L is computed against:
//
//   qty  = (margin × leverage) / entry
//   move = long ? exit - entry : entry - exit
//   pnl  = qty × move − commissions
//
// So $1k margin at 10× moving 100→110 nets $1,000 — ten times the un-leveraged $100.
//
// computePnl lives in trades.ts (imported here under plain node; the .ts import is type-stripped).
//
// Run: node web/app/home/journal/pnl.logic.test.mjs

import assert from 'node:assert/strict';

const { computePnl } = await import('./trades.ts');

/* ── 1. leverage multiplies the return (the bug this fixes) ── */
{
  const unlevered = computePnl(100, 110, 1000, 'long', 0, 1);
  const tenX = computePnl(100, 110, 1000, 'long', 0, 10);
  assert.equal(unlevered, 100, '$1k margin, 1×, 100→110 → $100');
  assert.equal(tenX, 1000, '$1k margin, 10×, 100→110 → $1,000');
  assert.equal(tenX, unlevered * 10, '10× leverage must be 10× the P&L');
}
console.log('✓ leverage scales P&L (10× → 10× the return)');

/* ── 2. default leverage of 1 leaves spot P&L unchanged ── */
{
  const spot = computePnl(100, 90, 2000, 'long', 0);
  assert.equal(spot, -200, 'omitted leverage defaults to 1× (spot behaviour)');
}
console.log('✓ leverage defaults to 1 when omitted');

/* ── 3. short direction inverts the move, leverage still applies ── */
{
  const short = computePnl(100, 90, 1000, 'short', 0, 5);
  // qty = (1000×5)/100 = 50; move = 100-90 = 10; pnl = 500
  assert.equal(short, 500, 'short 100→90 at 5× on $1k margin → +$500');
}
console.log('✓ short direction inverts the move and still scales by leverage');

/* ── 4. commissions are subtracted after the leveraged gross ── */
{
  const net = computePnl(100, 110, 1000, 'long', 25, 10);
  assert.equal(net, 975, 'commissions come off the leveraged gross ($1,000 − $25)');
}
console.log('✓ commissions subtract from the leveraged gross');

/* ── 5. degenerate inputs: no entry/size → only the commission cost ── */
{
  assert.equal(computePnl(0, 110, 1000, 'long', 5, 10), -5, 'no entry → just −commissions');
  assert.equal(computePnl(100, 110, 0, 'long', 5, 10), -5, 'no size → just −commissions');
  // A zero/negative leverage is coerced to 1× rather than zeroing the position.
  assert.equal(computePnl(100, 110, 1000, 'long', 0, 0), 100, 'leverage 0 coerced to 1×');
}
console.log('✓ degenerate entry/size/leverage handled');

console.log('\nAll trade-journal P&L tests passed.');
