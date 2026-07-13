// Pure-logic tests for the Wallet Tracker's chain filter.
//
// The bug this pins down: with 173 seeded wallets across 10 chains, the list rendered every wallet
// regardless of the chain picked in the dropdown — the dropdown only ever chose the chain a *new*
// address would be added on. Selecting "Solana" and still seeing Ethereum rows is the reported bug.
//
// The filter is its own function (filterByChain, mirrored from chains.ts) precisely so it can be
// tested without mounting React.
//
// Run: node app/home/wallet/walletFilter.logic.test.mjs

import assert from 'node:assert/strict';

/* ── The logic under test (mirrors filterByChain in chains.ts) ── */

const ALL_CHAINS = 'all';

function filterByChain(wallets, chainId) {
  if (!chainId || chainId === ALL_CHAINS) return wallets;
  return wallets.filter((w) => w.chain === chainId);
}

/** Per-chain counts for the filter pills — drives both the labels and which pills are shown. */
function chainCounts(wallets) {
  const counts = new Map();
  for (const w of wallets) counts.set(w.chain, (counts.get(w.chain) ?? 0) + 1);
  return counts;
}

/* ── The buggy render, for contrast: ignores the selection entirely ── */
const buggyRender = (wallets) => wallets;

/* ── Fixtures ── */

const WALLETS = [
  { id: '1', address: '0xaaa', chain: 'ethereum', label: 'Vitalik' },
  { id: '2', address: '0xbbb', chain: 'ethereum', label: 'Binance Cold' },
  { id: '3', address: '0xccc', chain: 'ethereum', label: 'Kraken' },
  { id: '4', address: 'SoL111', chain: 'solana', label: 'Alameda' },
  { id: '5', address: 'SoL222', chain: 'solana', label: 'Coinbase SOL' },
  { id: '6', address: 'Txxx', chain: 'tron', label: 'Binance Tron' },
  { id: '7', address: '0xddd', chain: 'polygon', label: 'WPOL' },
];

let passed = 0;
const t = (name, fn) => {
  fn();
  console.log(`  ok  ${name}`);
  passed++;
};

/* ── The reported bug ── */

t('REGRESSION: selecting Solana must not show Ethereum wallets', () => {
  const shown = filterByChain(WALLETS, 'solana');
  assert.equal(shown.length, 2, 'only the 2 Solana wallets should show');
  assert.ok(
    shown.every((w) => w.chain === 'solana'),
    'every visible wallet must be on Solana',
  );
  // And prove the old behaviour actually differs — otherwise this test proves nothing.
  assert.notDeepEqual(shown, buggyRender(WALLETS), 'filter must change what the buggy render showed');
  assert.ok(
    buggyRender(WALLETS).some((w) => w.chain === 'ethereum'),
    'the buggy render leaked Ethereum rows — that is the bug being fixed',
  );
});

t('each chain shows only its own wallets', () => {
  for (const chain of ['ethereum', 'solana', 'tron', 'polygon']) {
    const shown = filterByChain(WALLETS, chain);
    assert.ok(shown.length > 0, `${chain} should have wallets`);
    assert.ok(shown.every((w) => w.chain === chain), `${chain} leaked another chain's wallet`);
  }
});

t('"all" shows every wallet, unfiltered and in order', () => {
  assert.deepEqual(filterByChain(WALLETS, ALL_CHAINS), WALLETS);
});

/* ── Guards: what happens when the data is empty or the selection is junk ── */

t('a chain with no tracked wallets yields an empty list, not everything', () => {
  assert.deepEqual(filterByChain(WALLETS, 'near'), []);
});

t('an unknown/undefined selection falls back to showing all — never blanks the list', () => {
  assert.deepEqual(filterByChain(WALLETS, undefined), WALLETS);
  assert.deepEqual(filterByChain(WALLETS, ''), WALLETS);
});

t('an empty wallet list stays empty for any selection', () => {
  assert.deepEqual(filterByChain([], 'solana'), []);
  assert.deepEqual(filterByChain([], ALL_CHAINS), []);
});

t('filtering never mutates the source array', () => {
  const before = [...WALLETS];
  filterByChain(WALLETS, 'solana');
  assert.deepEqual(WALLETS, before);
});

/* ── Counts drive the pill labels ── */

t('chainCounts tallies each chain', () => {
  const c = chainCounts(WALLETS);
  assert.equal(c.get('ethereum'), 3);
  assert.equal(c.get('solana'), 2);
  assert.equal(c.get('tron'), 1);
  assert.equal(c.get('polygon'), 1);
  assert.equal(c.get('near'), undefined, 'a chain with no wallets has no count');
});

t('counts sum to the full list, so no wallet is unreachable by any filter', () => {
  const c = chainCounts(WALLETS);
  const total = [...c.values()].reduce((s, n) => s + n, 0);
  assert.equal(total, WALLETS.length);
  // Every wallet must be reachable through exactly one chain filter.
  const reachable = [...c.keys()].flatMap((chain) => filterByChain(WALLETS, chain));
  assert.equal(reachable.length, WALLETS.length);
});

console.log(`\n${passed} passed`);
console.log('ALL PASS');
