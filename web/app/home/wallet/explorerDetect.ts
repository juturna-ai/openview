// Pure client-side helpers for ExplorerView — chain-family resolution, hash-vs-address
// classification, and the tx-detail explorer URL. Split out of ExplorerView.tsx (a 'use client'
// component, not node-importable) so explorerDetect.logic.test.mjs can exercise them under plain
// `node`, same reasoning as tokenExplorer's split.

import { type Chain, detectChain, getChain } from './chains.ts';

/** Every EVM chain the breakdown/EVM-picker covers, ordered by prominence. Mirrors the server's
 *  EVM_CHAIN_IDS (app/api/explorer/chains.server.ts) — keep the two in sync. */
export const EVM_CHAIN_IDS = [
  'ethereum', 'bsc', 'polygon', 'base', 'arbitrum', 'optimism', 'avalanche',
  'gnosis', 'celo', 'scroll', 'zksync', 'mode', 'unichain', 'zora',
];

/** Chain-family pill → its member chains. `all` auto-detects; EVM groups the etherscan family. */
export const EXPLORER_FAMILIES: { id: string; label: string; chains: string[] }[] = [
  { id: 'all', label: 'All', chains: [] },
  { id: 'EVM', label: 'EVM', chains: EVM_CHAIN_IDS },
  { id: 'Solana', label: 'Solana', chains: ['solana'] },
  { id: 'SUI', label: 'SUI', chains: ['sui'] },
  { id: 'Cardano', label: 'Cardano', chains: ['cardano'] },
  { id: 'NEAR', label: 'NEAR', chains: ['near'] },
  { id: 'Injective', label: 'Injective', chains: ['injective'] },
  { id: 'Hyperliquid', label: 'Hyperliquid', chains: ['hyperliquid'] },
  { id: 'Hedera', label: 'Hedera', chains: ['hedera'] },
  { id: 'Bittensor', label: 'Bittensor', chains: ['bittensor'] },
  { id: 'Tron', label: 'Tron', chains: ['tron'] },
];

/**
 * Resolve the pasted query + active family to a concrete chain id. The family pill overrides
 * detectChain(): a single-chain family forces its chain, EVM forces the selected EVM chain, and
 * `all` falls back to address-shape detection. Returns null when nothing resolves.
 */
export function resolveChain(query: string, familyId: string, evmChain: string): string | null {
  const q = query.trim();
  if (!q) return null;
  const fam = EXPLORER_FAMILIES.find((f) => f.id === familyId);
  if (fam && fam.id !== 'all') {
    if (fam.id === 'EVM') return evmChain;
    return fam.chains[0];
  }
  return detectChain(q);
}

/** Is the query a tx hash (→ detail) rather than an address (→ history)? Chain-aware. */
export function classify(query: string, chain: string): 'tx' | 'address' {
  const q = query.trim();
  if (!getChain(chain)) return 'address';
  // EVM/others: 0x+64 hex is a tx hash — except Sui, where an address is also 0x+64 (treat as address).
  if (/^0x[a-fA-F0-9]{64}$/.test(q) && chain !== 'sui') return 'tx';
  if (chain === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(q)) return 'tx';
  if (chain === 'cardano' && /^[a-fA-F0-9]{64}$/.test(q)) return 'tx';
  if (chain === 'tron' && /^[a-fA-F0-9]{64}$/.test(q)) return 'tx';
  return 'address';
}

/** The tx-detail page URL on the chain's explorer (address path → tx path). Mirrors the server txUrl. */
export function txUrlClient(chain: Chain, hash: string): string {
  const base = chain.explorer;
  if (chain.id === 'tron') return base.replace('/#/address/', '/#/transaction/') + hash;
  if (chain.id === 'solana') return base.replace('/account/', '/tx/') + hash;
  if (chain.id === 'sui') return base.replace('/mainnet/account/', '/mainnet/tx/') + hash;
  if (chain.id === 'cardano') return base.replace('/address/', '/transaction/') + hash;
  if (chain.id === 'near') return base.replace('/address/', '/txns/') + hash;
  return base.replace('/address/', '/tx/') + hash;
}
