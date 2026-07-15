// Regression test for the wallet-tracker token detail on non-Ethereum chains.
//
// THE BUG: clicking a wallet on a chain other than Ethereum showed no token data. `getTokens` for an
// EVM chain looks the chain up in BLOCKSCOUT_HOSTS and, if there's no host, returns an empty token
// list with no error. Only ethereum/arbitrum/base had hosts, so polygon (POL), optimism, bsc and
// avalanche all silently rendered nothing — matching the user report "click a wallet from a chain
// that isn't ethereum, no data".
//
// polygon.blockscout.com and explorer.optimism.io are live and return token-balances with prices, so
// they MUST be wired up. bsc/avalanche have no healthy public Blockscout instance, so their token
// detail comes from Moralis instead (MORALIS_CHAINS) — every EVM chain must therefore resolve EITHER
// a Blockscout host OR a Moralis chain id, or its wallet detail shows nothing.
//
// The config lives in hosts.ts (not route.ts) so this file can import it under plain `node` —
// route.ts imports `next/server`, which doesn't resolve outside a Next build.
//
// Run: node web/app/api/wallet-tracker/route.logic.test.mjs

import assert from 'node:assert/strict';

const { BLOCKSCOUT_HOSTS, MORALIS_CHAINS } = await import('./hosts.ts');

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

// EVERY EVM chain must have a token source — Blockscout OR Moralis — so no chain's detail is blank.
// bsc/avalanche have no working Blockscout, so they must be covered by Moralis.
const EVM_CHAINS = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'];
for (const chain of EVM_CHAINS) {
  assert.ok(
    BLOCKSCOUT_HOSTS[chain] || MORALIS_CHAINS[chain],
    `${chain} must have a Blockscout host or a Moralis chain id (regression: non-ETH chains showed no token data)`,
  );
}
assert.equal(MORALIS_CHAINS.bsc, 'bsc', 'bsc token detail must fall back to Moralis');
assert.equal(MORALIS_CHAINS.avalanche, 'avalanche', 'avalanche token detail must fall back to Moralis');

console.log('ok — every EVM chain resolves a token source (Blockscout or Moralis)');
