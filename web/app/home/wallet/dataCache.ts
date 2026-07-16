// Module-level in-memory cache of the last successful fetch for each wallet/assets view.
//
// The dashboard tabs (Wallet, Wallet Tracker, Assets) mount and unmount as the user navigates —
// between the wallet sub-tabs and between the top-level folder-tab routes. Component state dies on
// unmount, so before this every revisit repainted an empty "Loading…" table and re-fetched every
// price/balance from scratch, even if the same data had arrived seconds earlier.
//
// This is a deliberately tiny last-value store (NOT a request cache or react-query): a view seeds
// its initial state from here so a revisit paints the previous data instantly, then its normal
// fetch effect refreshes in the background and writes the fresh result back. It lives only for the
// browser session (a plain module var), holds only already-public market data, and never gates a
// fetch — so a stale entry can never prevent a refresh, it only removes the empty flash.

/** Native-token prices from /api/wallet-tracker {action:'prices'} (tracker) — cgId → {usd, 24h}. */
let trackerPrices: Record<string, { usd?: number; usd_24h_change?: number }> | null = null;
/** Per-wallet native balances, keyed `${chain}:${address}` (tracker). */
let trackerBalances: Record<string, { balance: number; error?: string }> | null = null;
/** Holdings quotes from /api/market/prices (wallet portfolio) — symbol → {price, change24h}. */
let marketPrices: Record<string, { price: number; change24h: number } | null> | null = null;

export function getTrackerPrices() {
  return trackerPrices;
}
export function setTrackerPrices(v: Record<string, { usd?: number; usd_24h_change?: number }>) {
  trackerPrices = v;
}
export function getTrackerBalances() {
  return trackerBalances;
}
export function setTrackerBalances(v: Record<string, { balance: number; error?: string }>) {
  trackerBalances = v;
}
export function getMarketPrices() {
  return marketPrices;
}
export function setMarketPrices(v: Record<string, { price: number; change24h: number } | null>) {
  marketPrices = v;
}

// Generic keyed cache for the Movers/Leaderboards boards, which fetch several independent
// datasets (CMC listing, screener universes, fear&greed). One entry per dataset key.
const movers = new Map<string, unknown>();
export function getMovers<T>(key: string): T | null {
  return (movers.get(key) as T) ?? null;
}
export function setMovers<T>(key: string, value: T) {
  movers.set(key, value);
}

// Last Explorer result, so re-entering the tab repaints the previous search instantly instead of an
// empty hero. Keyed `chain:query`; holds only already-public on-chain data. Bounded so a long session
// can't grow it unboundedly.
const explorer = new Map<string, unknown>();
const EXPLORER_CACHE_MAX = 40;
export function getExplorerResult<T>(key: string): T | null {
  return (explorer.get(key) as T) ?? null;
}
export function setExplorerResult<T>(key: string, value: T) {
  if (explorer.size >= EXPLORER_CACHE_MAX && !explorer.has(key)) {
    const oldest = explorer.keys().next().value;
    if (oldest) explorer.delete(oldest);
  }
  explorer.set(key, value);
}
