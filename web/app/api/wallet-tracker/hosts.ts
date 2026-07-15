// Per-chain Blockscout hosts, extracted from route.ts so route.logic.test.mjs can import them under
// plain `node` (route.ts pulls in `next/server`, which doesn't resolve outside a Next build).
//
// Blockscout is preferred for balances (it also carries per-token USD rates for the token view). Only
// hosts verified to return /api/v2/addresses/{addr}/token-balances are listed — a chain with no entry
// here skips straight to its RPC for the balance and returns no token detail. bsc and avalanche have
// no healthy public Blockscout instance (their old hosts 404), so they stay balance-only.
export const BLOCKSCOUT_HOSTS: Record<string, string> = {
  ethereum: 'eth.blockscout.com',
  arbitrum: 'arbitrum.blockscout.com',
  base: 'base.blockscout.com',
  polygon: 'polygon.blockscout.com',
  optimism: 'explorer.optimism.io',
};
