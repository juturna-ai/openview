// Per-chain token-source config, extracted from route.ts so route.logic.test.mjs can import it under
// plain `node` (route.ts pulls in `next/server`, which doesn't resolve outside a Next build).
//
// Two keyless-ish sources cover EVM token detail:
//
//  1. Blockscout — preferred where a host is healthy. Carries per-token USD rates. Keyless.
//  2. Moralis — fallback for EVM chains with no working Blockscout (bsc, avalanche). Needs a free
//     API key in MORALIS_API_KEY; its /wallets/{addr}/tokens returns balances *and* USD prices in one
//     call. When the key is absent those chains degrade to balance-only (no token detail), same as
//     before Moralis was wired in.
//
// A chain with neither a Blockscout host nor a Moralis id returns no token detail.
export const BLOCKSCOUT_HOSTS: Record<string, string> = {
  ethereum: 'eth.blockscout.com',
  arbitrum: 'arbitrum.blockscout.com',
  base: 'base.blockscout.com',
  polygon: 'polygon.blockscout.com',
  optimism: 'explorer.optimism.io',
};

// Moralis `chain` query values for the EVM chains that have no healthy Blockscout instance.
export const MORALIS_CHAINS: Record<string, string> = {
  bsc: 'bsc',
  avalanche: 'avalanche',
};
