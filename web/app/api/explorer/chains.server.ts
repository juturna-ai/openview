// Per-chain transaction-source config for the Explorer route, extracted so
// normalize.logic.test.mjs can import it under plain `node` (route.ts pulls in `next/server`,
// which doesn't resolve outside a Next build). Mirrors the philosophy of ../wallet-tracker/hosts.ts.
//
// The Explorer looks up TRANSACTIONS (a tx hash, or an address' recent txns). It reuses the same
// keyless public providers the balance route already trusts (../wallet-tracker/route.ts):
//   - EVM with a healthy Blockscout host  → inline tx list + single-tx detail
//   - Solana / Sui / Cardano / NEAR       → each chain's own keyless RPC / REST index
//   - EVM without Blockscout (bsc/avax), Tron → NO keyless list here; the UI deep-links to the
//     chain's own explorer instead (honest, not an error). See DEEPLINK_ONLY below.
//
// `explorer` is the address-page base (ends in the chain's /address/ segment) — the same string the
// UI's chains.ts carries — so the tx-detail link can be derived by swapping the address path for the
// tx path (txUrl below), exactly as tokenExplorerUrl does in the wallet.

export type ExplorerChainType =
  | 'evm'
  | 'solana'
  | 'sui'
  | 'cardano'
  | 'near'
  | 'tron'
  | 'hyperliquid'
  | 'injective'
  | 'hedera'
  | 'bittensor';

export interface ExplorerChainCfg {
  type: ExplorerChainType;
  decimals: number;
  native: string;
  /** Blockscout host for EVM chains that have a healthy keyless instance; undefined → deep-link only. */
  blockscout?: string;
  /** RPC/REST base for non-EVM chains. */
  rpc?: string;
  /** Address-page base on the chain's public explorer (ends in the chain's /address/ segment). */
  explorer: string;
}

// Blockscout hosts that expose the v2 transactions API keyless. Same set the balance route uses
// (../wallet-tracker/hosts.ts), minus optimism's explorer.optimism.io which is a Blockscout-lite that
// doesn't serve /api/v2/addresses/{a}/transactions — optimism therefore deep-links here.
export const EXPLORER_CHAINS: Record<string, ExplorerChainCfg> = {
  ethereum: {
    type: 'evm', decimals: 18, native: 'ETH',
    blockscout: 'eth.blockscout.com',
    explorer: 'https://etherscan.io/address/',
  },
  arbitrum: {
    type: 'evm', decimals: 18, native: 'ETH',
    blockscout: 'arbitrum.blockscout.com',
    explorer: 'https://arbiscan.io/address/',
  },
  base: {
    type: 'evm', decimals: 18, native: 'ETH',
    blockscout: 'base.blockscout.com',
    explorer: 'https://basescan.org/address/',
  },
  polygon: {
    type: 'evm', decimals: 18, native: 'POL',
    blockscout: 'polygon.blockscout.com',
    explorer: 'https://polygonscan.com/address/',
  },
  optimism: {
    type: 'evm', decimals: 18, native: 'ETH',
    // No keyless v2 tx list → deep-link only.
    explorer: 'https://optimistic.etherscan.io/address/',
  },
  bsc: {
    type: 'evm', decimals: 18, native: 'BNB',
    explorer: 'https://bscscan.com/address/',
  },
  avalanche: {
    type: 'evm', decimals: 18, native: 'AVAX',
    explorer: 'https://snowtrace.io/address/',
  },
  solana: {
    type: 'solana', decimals: 9, native: 'SOL',
    rpc: 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io/account/',
  },
  sui: {
    type: 'sui', decimals: 9, native: 'SUI',
    rpc: 'https://fullnode.mainnet.sui.io:443',
    explorer: 'https://suiscan.xyz/mainnet/account/',
  },
  cardano: {
    type: 'cardano', decimals: 6, native: 'ADA',
    rpc: 'https://api.koios.rest/api/v1',
    explorer: 'https://cardanoscan.io/address/',
  },
  near: {
    type: 'near', decimals: 24, native: 'NEAR',
    rpc: 'https://api.nearblocks.io',
    explorer: 'https://nearblocks.io/address/',
  },
  tron: {
    type: 'tron', decimals: 6, native: 'TRX',
    // TronGrid's tx list is heavy and rate-limited keyless → deep-link only.
    explorer: 'https://tronscan.org/#/address/',
  },
  // ── Additional EVM chains with a healthy keyless Blockscout v2 instance (verified live). These
  // widen the multi-chain Token-Holdings breakdown beyond the original seven. Tx list works too.
  gnosis: { type: 'evm', decimals: 18, native: 'XDAI', blockscout: 'gnosis.blockscout.com', explorer: 'https://gnosisscan.io/address/' },
  celo: { type: 'evm', decimals: 18, native: 'CELO', blockscout: 'celo.blockscout.com', explorer: 'https://celoscan.io/address/' },
  mode: { type: 'evm', decimals: 18, native: 'ETH', blockscout: 'explorer.mode.network', explorer: 'https://explorer.mode.network/address/' },
  zksync: { type: 'evm', decimals: 18, native: 'ETH', blockscout: 'zksync.blockscout.com', explorer: 'https://era.zksync.network/address/' },
  unichain: { type: 'evm', decimals: 18, native: 'ETH', blockscout: 'unichain.blockscout.com', explorer: 'https://unichain.blockscout.com/address/' },
  scroll: { type: 'evm', decimals: 18, native: 'ETH', blockscout: 'scroll.blockscout.com', explorer: 'https://scrollscan.com/address/' },
  zora: { type: 'evm', decimals: 18, native: 'ETH', blockscout: 'explorer.zora.energy', explorer: 'https://explorer.zora.energy/address/' },
  // ── Non-EVM chains the Wallet Tracker prices but which have no keyless tx-list source: transactions
  // deep-link to the chain's explorer, while the Portfolio tab still works (native balance via
  // /api/wallet-tracker). Included so their addresses RESOLVE instead of "Unknown chain".
  hyperliquid: { type: 'hyperliquid', decimals: 0, native: 'HYPE', explorer: 'https://app.hyperliquid.xyz/explorer/address/' },
  injective: { type: 'injective', decimals: 18, native: 'INJ', explorer: 'https://explorer.injective.network/account/' },
  hedera: { type: 'hedera', decimals: 8, native: 'HBAR', explorer: 'https://hashscan.io/mainnet/account/' },
  bittensor: { type: 'bittensor', decimals: 9, native: 'TAO', explorer: 'https://taostats.io/account/' },
};

/** Chains with no keyless tx-list source: the UI shows a "View on explorer" deep-link instead. */
export function isDeepLinkOnly(chainId: string): boolean {
  const cfg = EXPLORER_CHAINS[chainId];
  if (!cfg) return true;
  if (cfg.type === 'evm') return !cfg.blockscout;
  // Only these five families have an inline tx-list source; everything else deep-links.
  const withTxList: ExplorerChainType[] = ['evm', 'solana', 'sui', 'cardano', 'near'];
  return !withTxList.includes(cfg.type);
}

/** Every EVM chain, ordered by prominence — drives the multi-chain breakdown + EVM sub-row. */
export const EVM_CHAIN_IDS = [
  'ethereum', 'bsc', 'polygon', 'base', 'arbitrum', 'optimism', 'avalanche',
  'gnosis', 'celo', 'scroll', 'zksync', 'mode', 'unichain', 'zora',
];

/**
 * Chain-family → the pill the UI shows. `EVM` groups every etherscan-family chain (they share the
 * 0x…40 address format, so the user disambiguates with the pill / EVM sub-row). Single-chain
 * families map 1:1.
 */
export const CHAIN_FAMILIES: Record<string, string[]> = {
  EVM: EVM_CHAIN_IDS,
  Solana: ['solana'],
  SUI: ['sui'],
  Cardano: ['cardano'],
  NEAR: ['near'],
  Injective: ['injective'],
  Hyperliquid: ['hyperliquid'],
  Hedera: ['hedera'],
  Bittensor: ['bittensor'],
  Tron: ['tron'],
};
