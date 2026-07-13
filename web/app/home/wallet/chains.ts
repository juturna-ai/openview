// Chain config + tracked-address persistence for the Wallet Tracker.
//
// Ported from Reach's WalletTrackerView.jsx. The RPC endpoints themselves live server-side (see
// app/api/wallet-tracker/route.ts) — what's here is only what the UI needs: labels, colours,
// explorer links, and the address-format sniffing that picks a chain as you type.

export interface Chain {
  id: string;
  label: string;
  symbol: string;
  color: string;
  explorer: string;
  /** CoinGecko id for the native token — the key the price map comes back under. */
  cgId: string;
}

export const CHAINS: Chain[] = [
  { id: 'ethereum', label: 'Ethereum', symbol: 'ETH', color: '#627eea', explorer: 'https://etherscan.io/address/', cgId: 'ethereum' },
  { id: 'bsc', label: 'BNB Chain', symbol: 'BNB', color: '#f3ba2f', explorer: 'https://bscscan.com/address/', cgId: 'binancecoin' },
  { id: 'polygon', label: 'Polygon', symbol: 'POL', color: '#8247e5', explorer: 'https://polygonscan.com/address/', cgId: 'matic-network' },
  { id: 'arbitrum', label: 'Arbitrum', symbol: 'ETH', color: '#28a0f0', explorer: 'https://arbiscan.io/address/', cgId: 'ethereum' },
  { id: 'optimism', label: 'Optimism', symbol: 'ETH', color: '#ff0420', explorer: 'https://optimistic.etherscan.io/address/', cgId: 'ethereum' },
  { id: 'base', label: 'Base', symbol: 'ETH', color: '#0052ff', explorer: 'https://basescan.org/address/', cgId: 'ethereum' },
  { id: 'avalanche', label: 'Avalanche', symbol: 'AVAX', color: '#e84142', explorer: 'https://snowtrace.io/address/', cgId: 'avalanche-2' },
  { id: 'solana', label: 'Solana', symbol: 'SOL', color: '#9945ff', explorer: 'https://solscan.io/account/', cgId: 'solana' },
  { id: 'tron', label: 'Tron', symbol: 'TRX', color: '#ef0027', explorer: 'https://tronscan.org/#/address/', cgId: 'tron' },
  { id: 'near', label: 'NEAR', symbol: 'NEAR', color: '#000000', explorer: 'https://nearblocks.io/address/', cgId: 'near' },
];

export function getChain(id: string): Chain | undefined {
  return CHAINS.find((c) => c.id === id);
}

/**
 * Guesses the chain from an address's shape. EVM chains all share the 0x…40 format, so a match there
 * is inherently ambiguous — it resolves to Ethereum and the user re-picks from the dropdown if they
 * meant an L2. Returns null when nothing matches.
 */
export function detectChain(address: string): string | null {
  const a = address.trim();
  if (!a) return null;
  if (a.startsWith('T') && a.length === 34) return 'tron';
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'ethereum';
  if (a.endsWith('.near') || a.endsWith('.testnet')) return 'near';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'solana';
  return null;
}

export function truncAddr(addr: string): string {
  if (!addr || addr.length < 16) return addr;
  return addr.slice(0, 8) + '...' + addr.slice(-6);
}

export function fmtBal(bal: number | null | undefined): string {
  if (bal == null) return '0';
  if (bal < 0.0001) return bal.toFixed(8);
  if (bal < 1) return bal.toFixed(6);
  if (bal < 1000) return bal.toFixed(4);
  return bal.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtUsdVal(val: number | null | undefined): string {
  if (val == null || val === 0) return '$0.00';
  if (val < 0.01) return `$${val.toFixed(6)}`;
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Tracked wallets (localStorage) ──

export interface TrackedWallet {
  id: string;
  address: string;
  chain: string;
  /** Present on the seeded whale wallets; user-added addresses have none. */
  label?: string;
}

export const TRACKED_KEY = 'ov_tracked_wallets';

/**
 * The 20 known whale/exchange wallets Reach ships with, seeded on first visit so the tracker opens
 * with something live in it rather than an empty box. All are public, well-known addresses.
 * `loadDefaults()` restores this set; removing them all and reloading does NOT bring them back
 * (see loadTracked) — once the user has curated the list, it stays curated.
 */
export const DEFAULT_WALLETS: Omit<TrackedWallet, 'id'>[] = [
  { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'ethereum', label: 'Vitalik Buterin' },
  { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', chain: 'ethereum', label: 'Binance Cold Wallet' },
  { address: '0x28C6c06298d514Db089934071355E5743bf21d60', chain: 'ethereum', label: 'Binance Hot Wallet' },
  { address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe', chain: 'ethereum', label: 'Ethereum Foundation' },
  { address: '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2', chain: 'ethereum', label: 'Kraken' },
  { address: '0x00000000AE347930bD1E7B0F35588b92280f9e75', chain: 'ethereum', label: 'Wintermute' },
  { address: '0x59ABf3837Fa962d6853b4Cc0a19513AA031fd32b', chain: 'ethereum', label: 'FTX Exploiter' },
  { address: '0x176F3DAb24a159341c0509bB36B833E7fdd0a132', chain: 'ethereum', label: 'Justin Sun' },
  { address: '0x9507c04B10486547584C37bCBd931B5a4eC8fA94', chain: 'ethereum', label: 'Jump Trading' },
  { address: '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', chain: 'ethereum', label: 'Coinbase Prime' },
  { address: '0x1B72Bac3772050FDCaF468CcE7e20deb3cB02d89', chain: 'ethereum', label: 'Paradigm' },
  { address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', chain: 'ethereum', label: 'Binance Whale' },
  { address: '0xB38e8c17e38363aF6EbdCb3dAE12e0243582891D', chain: 'arbitrum', label: 'Arbitrum Bridge' },
  { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', chain: 'bsc', label: 'Binance BSC Hot' },
  { address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', chain: 'polygon', label: 'WMATIC Contract' },
  { address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', chain: 'solana', label: 'Alameda Research' },
  { address: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', chain: 'solana', label: 'Coinbase Solana' },
  // Reach's list has 'TLyqzVGLV1srkB7dToTAEQgDSFPg9BB3in' here (labelled "Justin Sun"), but TronGrid
  // rejects it outright — it fails base58 checksum, so it could never resolve. Swapped for Binance's
  // main Tron cold wallet, which is real (verified: ~2.01B TRX).
  { address: 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb', chain: 'tron', label: 'Binance Tron Cold' },
  { address: 'TNaRAoLUyYEV2uF7GUrzSjRQTU8v5ZJ5VR', chain: 'tron', label: 'Binance Tron Hot' },
  { address: 'aurora', chain: 'near', label: 'Aurora Bridge' },
];

export function defaultWallets(): TrackedWallet[] {
  return DEFAULT_WALLETS.map((w, i) => ({ ...w, id: `default-${i}` }));
}

/**
 * Reads the tracked list, seeding the whale defaults **only when nothing has ever been stored**.
 * The distinction matters: Reach falls back to the defaults whenever the stored array is empty, so
 * a user who deliberately removes every wallet gets all 20 back on the next load and can never
 * reach an empty tracker. Here, an explicit stored `[]` is honoured as an empty list.
 */
export function loadTracked(): TrackedWallet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TRACKED_KEY);
    if (raw === null) return defaultWallets(); // first visit — never stored
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultWallets();
    return parsed.filter(
      (w): w is TrackedWallet =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as TrackedWallet).address === 'string' &&
        typeof (w as TrackedWallet).id === 'string' &&
        !!getChain((w as TrackedWallet).chain),
    );
  } catch {
    return defaultWallets();
  }
}

export function saveTracked(wallets: TrackedWallet[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRACKED_KEY, JSON.stringify(wallets));
  } catch {
    /* storage blocked — keep the in-memory list */
  }
}
