// Pure, `next/server`-free helpers for the Explorer route: classify a pasted string, normalize each
// upstream's tx payload into one chain-agnostic shape, and build the tx-detail deep-link. Split from
// route.ts (same reason ../wallet-tracker/hosts.ts is split) so normalize.logic.test.mjs runs under
// plain `node`.

// Kept import-free (no sibling .ts imports) so normalize.logic.test.mjs resolves it under plain
// `node`, which doesn't resolve extensionless relative specifiers the way the bundler does — the
// same reason hosts.ts / chains.ts are self-contained. The minimal per-chain facts the normalizers
// need (native symbol, decimals, explorer base) are inlined below rather than imported from
// chains.server.ts; route.ts owns the full table.

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

/** Native symbol + decimals + explorer address-base per chain — the subset the normalizers touch. */
const CHAIN_FACTS: Record<string, { type: ExplorerChainType; decimals: number; native: string; explorer: string }> = {
  ethereum: { type: 'evm', decimals: 18, native: 'ETH', explorer: 'https://etherscan.io/address/' },
  arbitrum: { type: 'evm', decimals: 18, native: 'ETH', explorer: 'https://arbiscan.io/address/' },
  base: { type: 'evm', decimals: 18, native: 'ETH', explorer: 'https://basescan.org/address/' },
  polygon: { type: 'evm', decimals: 18, native: 'POL', explorer: 'https://polygonscan.com/address/' },
  optimism: { type: 'evm', decimals: 18, native: 'ETH', explorer: 'https://optimistic.etherscan.io/address/' },
  bsc: { type: 'evm', decimals: 18, native: 'BNB', explorer: 'https://bscscan.com/address/' },
  avalanche: { type: 'evm', decimals: 18, native: 'AVAX', explorer: 'https://snowtrace.io/address/' },
  solana: { type: 'solana', decimals: 9, native: 'SOL', explorer: 'https://solscan.io/account/' },
  sui: { type: 'sui', decimals: 9, native: 'SUI', explorer: 'https://suiscan.xyz/mainnet/account/' },
  cardano: { type: 'cardano', decimals: 6, native: 'ADA', explorer: 'https://cardanoscan.io/address/' },
  near: { type: 'near', decimals: 24, native: 'NEAR', explorer: 'https://nearblocks.io/address/' },
  tron: { type: 'tron', decimals: 6, native: 'TRX', explorer: 'https://tronscan.org/#/address/' },
};

/** One transaction, normalized across every chain source so the UI is chain-agnostic. */
export interface ExplorerTx {
  hash: string;
  chain: string;
  timestamp: number | null; // unix seconds
  from: string;
  to: string;
  value: number; // native coin, human units
  symbol: string; // native symbol
  fee: number | null;
  status: 'success' | 'failed' | 'pending' | null;
  method: string | null; // decoded method / tx kind label
  direction: 'in' | 'out' | 'self' | null; // relative to the queried address (null for single-tx lookup)
}

/** Divides a raw integer balance by its decimals without a lossy Number cast. Mirrors route.ts. */
export function fromUnits(raw: bigint, decimals: number): number {
  const d = BigInt(10) ** BigInt(decimals);
  const whole = raw / d;
  const frac = raw % d;
  return Number(whole) + Number(frac) / Number(d);
}

/** in/out/self relative to the queried address (case-insensitive; addresses compared lowercased). */
export function directionFor(
  queried: string,
  from: string,
  to: string,
): 'in' | 'out' | 'self' | null {
  if (!queried) return null;
  const q = queried.toLowerCase();
  const f = (from || '').toLowerCase();
  const t = (to || '').toLowerCase();
  const isFrom = f === q;
  const isTo = t === q;
  if (isFrom && isTo) return 'self';
  if (isFrom) return 'out';
  if (isTo) return 'in';
  return null;
}

/**
 * Is this pasted string a transaction hash (→ single-tx lookup) rather than an address (→ history)?
 * Chain-specific because the two collide on some families (EVM address is 0x+40, tx is 0x+64; Sui
 * address and digest are both 0x+64 hex — indistinguishable, so Sui defaults to address unless the
 * caller already knows it's a tx). base58 chains (solana) can't tell a 44-char address from an 88-char
 * signature by charset alone, so length is the tell.
 */
export function isTxHash(value: string, type: ExplorerChainType): boolean {
  const v = value.trim();
  if (type === 'evm') return /^0x[a-fA-F0-9]{64}$/.test(v);
  if (type === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(v); // base58 signature
  if (type === 'sui') return false; // 0x+64 hex is ambiguous with an address; treat as address
  if (type === 'cardano') return /^[a-fA-F0-9]{64}$/.test(v); // tx hash is bare 64-hex (addr is addr1…)
  if (type === 'near') return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(v); // base58 tx hash
  if (type === 'tron') return /^[a-fA-F0-9]{64}$/.test(v);
  return false;
}

/** Validate a tx hash per family before it's interpolated into an upstream URL (mirrors validAddress). */
export function validHash(value: string, type: ExplorerChainType): boolean {
  const v = value.trim();
  if (type === 'evm') return /^0x[a-fA-F0-9]{64}$/.test(v);
  if (type === 'sui') return /^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(v); // base58 digest
  if (type === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(v);
  if (type === 'cardano' || type === 'tron') return /^[a-fA-F0-9]{64}$/.test(v);
  if (type === 'near') return /^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(v);
  return false;
}

/**
 * The tx-detail page URL on the chain's public explorer, derived from the address-page base by
 * swapping the address segment for the tx segment — same technique as the wallet's tokenExplorerUrl.
 *   - EVM etherscan-family: /address/ → /tx/
 *   - Solana solscan:       /account/ → /tx/
 *   - Sui suiscan:          /account/ → /tx/
 *   - Cardano cardanoscan:  /address/ → /transaction/
 *   - NEAR nearblocks:      /address/ → /txns/
 *   - Tron tronscan:        /#/address/ → /#/transaction/
 */
export function txUrl(chainId: string, hash: string): string {
  const cfg = CHAIN_FACTS[chainId];
  if (!cfg) return '';
  const base = cfg.explorer;
  if (chainId === 'tron') return base.replace('/#/address/', '/#/transaction/') + hash;
  if (cfg.type === 'solana' || cfg.type === 'sui') return base.replace('/account/', '/tx/') + hash;
  if (cfg.type === 'cardano') return base.replace('/address/', '/transaction/') + hash;
  if (cfg.type === 'near') return base.replace('/address/', '/txns/') + hash;
  return base.replace('/address/', '/tx/') + hash; // EVM family
}

// ── Per-source normalizers ─────────────────────────────────────────────────────────────────────
// Each takes the raw upstream item(s) + the queried address (for direction) and returns ExplorerTx.
// Kept side-effect-free and pure so the logic test can feed captured fixtures.

interface BlockscoutTx {
  hash?: string;
  timestamp?: string; // ISO string
  from?: { hash?: string };
  to?: { hash?: string } | null;
  value?: string; // wei
  fee?: { value?: string } | null;
  status?: string; // 'ok' | 'error'
  result?: string; // 'success' | ...
  method?: string | null;
}

export function normalizeBlockscout(
  raw: BlockscoutTx,
  chainId: string,
  queried: string,
): ExplorerTx {
  const cfg = CHAIN_FACTS[chainId];
  const decimals = cfg?.decimals ?? 18;
  const from = raw.from?.hash ?? '';
  const to = raw.to?.hash ?? '';
  let value = 0;
  try {
    value = fromUnits(BigInt(raw.value ?? '0'), decimals);
  } catch {
    value = 0;
  }
  let fee: number | null = null;
  if (raw.fee?.value) {
    try {
      fee = fromUnits(BigInt(raw.fee.value), decimals);
    } catch {
      fee = null;
    }
  }
  const ts = raw.timestamp ? Math.floor(Date.parse(raw.timestamp) / 1000) : null;
  const status: ExplorerTx['status'] =
    raw.status === 'ok' || raw.result === 'success'
      ? 'success'
      : raw.status === 'error' || raw.result
        ? 'failed'
        : null;
  return {
    hash: raw.hash ?? '',
    chain: chainId,
    timestamp: Number.isFinite(ts) ? ts : null,
    from,
    to,
    value,
    symbol: cfg?.native ?? '',
    fee,
    status,
    method: raw.method ?? null,
    direction: directionFor(queried, from, to),
  };
}

interface SolanaSig {
  signature?: string;
  blockTime?: number | null;
  err?: unknown;
}

export function normalizeSolanaSig(raw: SolanaSig, queried: string): ExplorerTx {
  return {
    hash: raw.signature ?? '',
    chain: 'solana',
    timestamp: typeof raw.blockTime === 'number' ? raw.blockTime : null,
    from: queried, // getSignaturesForAddress lists sigs involving the address; no from/to without a full fetch
    to: '',
    value: 0,
    symbol: 'SOL',
    fee: null,
    status: raw.err ? 'failed' : 'success',
    method: null,
    direction: null,
  };
}

interface SuiTxBlock {
  digest?: string;
  timestampMs?: string | number;
  transaction?: { data?: { sender?: string } };
  effects?: { status?: { status?: string }; gasUsed?: Record<string, string> };
}

export function normalizeSui(raw: SuiTxBlock, queried: string): ExplorerTx {
  const sender = raw.transaction?.data?.sender ?? '';
  const ms = raw.timestampMs != null ? Number(raw.timestampMs) : NaN;
  const st = raw.effects?.status?.status;
  let fee: number | null = null;
  const g = raw.effects?.gasUsed;
  if (g) {
    try {
      const used =
        BigInt(g.computationCost ?? '0') +
        BigInt(g.storageCost ?? '0') -
        BigInt(g.storageRebate ?? '0');
      fee = fromUnits(used < BigInt(0) ? BigInt(0) : used, 9);
    } catch {
      fee = null;
    }
  }
  return {
    hash: raw.digest ?? '',
    chain: 'sui',
    timestamp: Number.isFinite(ms) ? Math.floor(ms / 1000) : null,
    from: sender,
    to: '',
    value: 0,
    symbol: 'SUI',
    fee,
    status: st === 'success' ? 'success' : st ? 'failed' : null,
    method: null,
    direction: directionFor(queried, sender, ''),
  };
}

interface CardanoTx {
  tx_hash?: string;
  tx_timestamp?: number;
  block_time?: number;
}

export function normalizeCardano(raw: CardanoTx): ExplorerTx {
  const ts = raw.tx_timestamp ?? raw.block_time ?? null;
  return {
    hash: raw.tx_hash ?? '',
    chain: 'cardano',
    timestamp: typeof ts === 'number' ? ts : null,
    from: '',
    to: '',
    value: 0,
    symbol: 'ADA',
    fee: null,
    status: 'success',
    method: null,
    direction: null,
  };
}

interface NearTx {
  transaction_hash?: string;
  block_timestamp?: string | number; // nanoseconds
  // nearblocks v1 uses predecessor/receiver; older callers used signer — accept both.
  predecessor_account_id?: string;
  signer_account_id?: string;
  receiver_account_id?: string;
  actions?: { action?: string; method?: string }[];
  actions_agg?: { deposit?: number };
  outcomes?: { status?: boolean };
}

export function normalizeNear(raw: NearTx, queried: string): ExplorerTx {
  const from = raw.predecessor_account_id ?? raw.signer_account_id ?? '';
  const to = raw.receiver_account_id ?? '';
  // nearblocks block_timestamp is nanoseconds; → seconds.
  let ts: number | null = null;
  if (raw.block_timestamp != null) {
    const n = Number(raw.block_timestamp);
    if (Number.isFinite(n)) ts = Math.floor(n / 1e9);
  }
  const deposit = raw.actions_agg?.deposit;
  let value = 0;
  if (typeof deposit === 'number') value = deposit / 10 ** 24;
  // Prefer the specific method name (e.g. "on_account_created") over the generic action kind.
  const act = raw.actions?.[0];
  const method = act?.method ?? act?.action ?? null;
  return {
    hash: raw.transaction_hash ?? '',
    chain: 'near',
    timestamp: ts,
    from,
    to,
    value,
    symbol: 'NEAR',
    fee: null,
    status: raw.outcomes?.status === false ? 'failed' : 'success',
    method,
    direction: directionFor(queried, from, to),
  };
}
