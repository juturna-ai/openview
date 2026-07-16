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

const { BLOCKSCOUT_HOSTS, MORALIS_CHAINS, nativeTokenHoldings, parseFtMetadata } = await import('./hosts.ts');

const toBytes = (s) => [...s].map((c) => c.charCodeAt(0));

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

// THE NEAR BUG: getTokens had no NEAR branch — it short-circuited to { tokens: [], totalUsd: 0 }, so
// clicking a funded NEAR wallet showed "$0.00 / No tokens found" even though its native balance was
// known. The fix synthesises a single native NEAR token row via nativeTokenHoldings, priced off the
// CoinGecko quote. A funded, priced wallet must yield exactly one native row with a non-zero total.
{
  const balance = 1_554_936.07;
  const price = 2.06;
  const res = nativeTokenHoldings('NEAR', balance, price);
  assert.equal(res.tokens.length, 1, 'a funded NEAR wallet must render its native token row (regression: showed "no tokens found")');
  const [t] = res.tokens;
  assert.equal(t.symbol, 'NEAR');
  assert.equal(t.type, 'native');
  assert.equal(t.balance, balance);
  assert.equal(t.price, price);
  assert.ok(t.usdValue > 0, 'the native NEAR row must carry a USD value (regression: showed $0.00)');
  assert.ok(res.totalUsd > 0, 'total value must be non-zero for a funded NEAR wallet (regression: showed $0.00)');
  assert.equal(res.totalUsd, balance * price);
}

// A zero-balance wallet still returns a (zero-value) native row rather than an empty list, matching
// how EVM/Solana/Tron always seed the native coin.
{
  const res = nativeTokenHoldings('NEAR', 0, 2.06);
  assert.equal(res.tokens.length, 1);
  assert.equal(res.totalUsd, 0);
}

console.log('ok — NEAR wallet detail synthesises its native token row with a priced total');

// NEP-141 surfacing: ft_metadata returns the contract's JSON as a byte array; parseFtMetadata must
// decode it and apply the detail-panel fallbacks (contract-prefix symbol, 24 decimals, drop remote
// icons). This is what turns a bare contract id + raw balance into a labelled token row.
{
  const meta = parseFtMetadata(
    toBytes(JSON.stringify({ spec: 'ft-1.0.0', name: 'Wrapped NEAR', symbol: 'wNEAR', decimals: 24, icon: 'data:image/svg+xml,x' })),
    'wrap.near',
  );
  assert.equal(meta.symbol, 'wNEAR');
  assert.equal(meta.name, 'Wrapped NEAR');
  assert.equal(meta.decimals, 24);
  assert.equal(meta.icon, 'data:image/svg+xml,x', 'inline data-URI icons are kept');
}

// Missing symbol → fall back to the contract-id prefix; missing decimals → 24; remote icon dropped.
{
  const meta = parseFtMetadata(
    toBytes(JSON.stringify({ name: 'Token', icon: 'https://evil.example/x.png' })),
    'usdt.tether-token.near',
  );
  assert.equal(meta.symbol, 'usdt', 'symbol falls back to the contract-id prefix');
  assert.equal(meta.decimals, 24, 'decimals fall back to 24');
  assert.equal(meta.icon, '', 'remote (non-data:) icons are dropped so the client uses generated art');
}

// A non-array (RPC error / no return value) or garbage bytes must yield null, not throw — the token
// is then skipped rather than crashing the whole NEAR detail fetch.
assert.equal(parseFtMetadata(undefined, 'x.near'), null);
assert.equal(parseFtMetadata(toBytes('not json'), 'x.near'), null);

console.log('ok — NEP-141 ft_metadata decodes with symbol/decimals/icon fallbacks');
