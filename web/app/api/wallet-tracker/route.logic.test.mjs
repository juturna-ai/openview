// Regression test for the wallet-tracker token detail on non-Ethereum chains.
//
// THE BUG: clicking a wallet on a chain other than Ethereum showed no token data. `getTokens` for an
// EVM chain looks the chain up in BLOCKSCOUT_HOSTS and, if there's no host, returns an empty token
// list with no error. Only ethereum/arbitrum/base had hosts, so polygon (POL), optimism, bsc and
// avalanche all silently rendered nothing — matching the user report "click a wallet from a chain
// that isn't ethereum, no data".
//
// polygon.blockscout.com and explorer.optimism.io are live and return token-balances with prices, so
// they MUST be wired up. bsc/avalanche have no healthy public Blockscout instance, so they stay
// balance-only (asserted below so a future host addition updates this test deliberately).
//
// BLOCKSCOUT_HOSTS lives in hosts.ts (not route.ts) so this file can import it under plain `node` —
// route.ts imports `next/server`, which doesn't resolve outside a Next build.
//
// Run: node web/app/api/wallet-tracker/route.logic.test.mjs

import assert from 'node:assert/strict';

const { BLOCKSCOUT_HOSTS } = await import('./hosts.ts');

// Chains that have a verified-working Blockscout host and must resolve one for token detail.
const MUST_HAVE_HOST = ['ethereum', 'arbitrum', 'base', 'polygon', 'optimism'];

for (const chain of MUST_HAVE_HOST) {
  assert.ok(
    typeof BLOCKSCOUT_HOSTS[chain] === 'string' && BLOCKSCOUT_HOSTS[chain].length > 0,
    `${chain} must have a Blockscout host so its wallet token detail loads (regression: non-ETH chains showed no data)`,
  );
}

// The two chains that were the actual complaint.
assert.equal(BLOCKSCOUT_HOSTS.polygon, 'polygon.blockscout.com');
assert.equal(BLOCKSCOUT_HOSTS.optimism, 'explorer.optimism.io');

// bsc/avalanche have no working public Blockscout yet — documented as balance-only.
assert.ok(!BLOCKSCOUT_HOSTS.bsc, 'bsc has no healthy Blockscout host; keep it balance-only until one exists');
assert.ok(!BLOCKSCOUT_HOSTS.avalanche, 'avalanche has no healthy Blockscout host; keep it balance-only until one exists');

console.log('ok — BLOCKSCOUT_HOSTS covers every chain with a working Blockscout instance');
