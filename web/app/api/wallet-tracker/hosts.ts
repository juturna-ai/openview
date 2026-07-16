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

/**
 * Build the token-detail payload for a chain that has only its native coin to report (NEAR): a single
 * native-token row, priced off the native USD quote. Kept here (not route.ts) so it's testable under
 * plain `node`. NEAR would otherwise render "$0.00 / no tokens found" for a funded wallet, because
 * getTokens has no fungible-token index for it — only its native balance is known.
 */
/**
 * Decode a NEP-141 ft_metadata view-call result into the fields the token detail needs. NEAR returns
 * a contract's return value as a byte array of its JSON; this parses that and applies the same
 * fallbacks getNearTokens uses (symbol ← contract prefix, decimals ← 24, remote icons dropped so the
 * client falls back to generated art). Extracted here so it's testable under plain `node`.
 */
export function parseFtMetadata(bytes: unknown, contractId: string) {
  if (!Array.isArray(bytes)) return null;
  let meta: { symbol?: string; name?: string; decimals?: number; icon?: string };
  try {
    meta = JSON.parse(String.fromCharCode(...bytes));
  } catch {
    return null;
  }
  return {
    symbol: meta.symbol || contractId.split('.')[0],
    name: meta.name || '',
    decimals: typeof meta.decimals === 'number' ? meta.decimals : 24,
    icon: meta.icon?.startsWith('data:') ? meta.icon : '',
  };
}

export function nativeTokenHoldings(symbol: string, balance: number, price: number) {
  const tokens = [
    {
      symbol,
      name: symbol,
      balance,
      usdValue: balance * price,
      price,
      type: 'native',
      thumb: '',
      contractAddress: '',
    },
  ];
  return { tokens, totalUsd: balance * price, truncated: false, totalCount: tokens.length };
}
