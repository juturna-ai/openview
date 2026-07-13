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
  // cgId must match the route's CHAINS map — see the POL/matic-network note there.
  { id: 'polygon', label: 'Polygon', symbol: 'POL', color: '#8247e5', explorer: 'https://polygonscan.com/address/', cgId: 'polygon-ecosystem-token' },
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

/** Sentinel for "no chain filter" — the wallet list's default. */
export const ALL_CHAINS = 'all';

/**
 * The wallets visible under the current chain filter. Kept as a standalone function (rather than an
 * inline `.filter` in the view) so it can be unit-tested — see walletFilter.logic.test.mjs.
 *
 * An unrecognised or missing `chainId` falls back to showing everything. Blanking the list would be
 * the worse failure: the user would see an empty tracker and assume their wallets were lost.
 */
export function filterByChain(wallets: TrackedWallet[], chainId: string | undefined): TrackedWallet[] {
  if (!chainId || chainId === ALL_CHAINS) return wallets;
  return wallets.filter((w) => w.chain === chainId);
}

/** How many tracked wallets sit on each chain — drives the filter pills' labels and which appear. */
export function chainCounts(wallets: TrackedWallet[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of wallets) counts.set(w.chain, (counts.get(w.chain) ?? 0) + 1);
  return counts;
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, preserving input order in the
 * result. The tracker seeds ~200 wallets across 10 chains and refreshes every 60s; firing all of
 * them at once (as the original one-Promise.all-per-wallet did) buries the keyless public RPCs and
 * they start rejecting. A worker pool keeps the request rate survivable without serialising the
 * whole list.
 *
 * Errors are the caller's to handle — `fn` is expected to catch and return a fallback, as a throw
 * here would abandon the remaining items in that worker's slice.
 */
export async function poolMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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
 * The seeded whale set: the ~20 largest verified public wallets on each of the 10 supported chains
 * (173 in total — some chains have fewer than 20 addresses that are both publicly identified and
 * hold a meaningful native balance, and padding those out would have meant inventing addresses).
 *
 * Every entry was checked against /api/wallet-tracker before being committed: it passes that chain's
 * address validator AND returns a non-zero native balance. That bar exists because a wrong address
 * fails silently — it renders a normal-looking card reading $0.00 rather than an error. The list is
 * ordered by chain (matching CHAINS above), then by USD value within each chain.
 *
 * `loadDefaults()` restores this set; removing them all and reloading does NOT bring them back
 * (see loadTracked) — once the user has curated the list, it stays curated.
 */
export const DEFAULT_WALLETS: Omit<TrackedWallet, 'id'>[] = [
  { address: '0x00000000219ab540356cBB839Cbe05303d7705Fa', chain: 'ethereum', label: 'Beacon Deposit Contract' },
  { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'ethereum', label: 'Wrapped Ether (WETH)' },
  { address: '0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8', chain: 'ethereum', label: 'Binance Cold Wallet' },
  { address: '0x40B38765696e3d5d8d9d834D8AaD4bB6e418E489', chain: 'ethereum', label: 'Robinhood' },
  { address: '0x0E58e8993100f1cbe45376c410f97f4893d9BfCD', chain: 'ethereum', label: 'Upbit 41' },
  { address: '0x49048044D57e1C92A77f79988d21Fa8fAF74E97e', chain: 'ethereum', label: 'Base Portal' },
  { address: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a', chain: 'ethereum', label: 'Arbitrum Bridge' },
  { address: '0xF977814e90dA44bFA03b6295A0616a897441aceC', chain: 'ethereum', label: 'Binance Hot Wallet 20' },
  { address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503', chain: 'ethereum', label: 'Binance Whale' },
  { address: '0xE92d1A43df510F82c66382592a047d288f85226F', chain: 'ethereum', label: 'Bitfinex 19' },
  { address: '0x28C6c06298d514Db089934071355E5743bf21d60', chain: 'ethereum', label: 'Binance Hot Wallet 14' },
  { address: '0x77134cbc06cb00b66f4c7e623d5fdbf6777635ec', chain: 'ethereum', label: 'Bitfinex Hot Wallet' },
  { address: '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe', chain: 'ethereum', label: 'Ethereum Foundation' },
  { address: '0xf584F8728B874a6a5c7A8d4d387C9aae9172D621', chain: 'ethereum', label: 'Jump Trading 2' },
  { address: '0xf89d7b9c864f589bBF53a82105107622B35EAA40', chain: 'ethereum', label: 'Bybit Hot Wallet' },
  { address: '0x59ABf3837Fa962d6853b4Cc0a19513AA031fd32b', chain: 'ethereum', label: 'FTX Exploiter' },
  { address: '0x2c8FBB630289363Ac80705A1a61273f76fD5a161', chain: 'ethereum', label: 'OKX 4' },
  { address: '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', chain: 'ethereum', label: 'Coinbase Prime' },
  { address: '0x267be1C1D684F78cb4F6a176c4911b741E4Ffdc0', chain: 'ethereum', label: 'Kraken 4' },
  { address: '0x5eD8Cee6b63b1c6AFce3AD7c92f4fD7E1B8fAd9F', chain: 'ethereum', label: 'Ethereum Foundation 1' },
  { address: '0xff3f428583c15a5681584e9e5e86e270418ac4d3', chain: 'bsc', label: 'BNB Top Holder' },
  { address: '0x0000000000000000000000000000000000001004', chain: 'bsc', label: 'BSC Token Hub' },
  { address: '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8', chain: 'bsc', label: 'Binance 7' },
  { address: '0xd37c9b07304c6e3396a81a176c9e3b45a9aa07ca', chain: 'bsc', label: 'BNB Whale' },
  { address: '0x835678a611b28684005a5e2233695fb6cbbb0007', chain: 'bsc', label: 'Binance 70' },
  { address: '0x771f4c697b35677b107f9ddc9cea0c2976a9a23e', chain: 'bsc', label: 'BNB Whale 2' },
  { address: '0x5c0d693b30d5e494421d0589729a26ab86ed1948', chain: 'bsc', label: 'BNB Whale 3' },
  { address: '0x00389542170d59184dc056f942b3a8234d5318c9', chain: 'bsc', label: 'BNB Whale 4' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', chain: 'bsc', label: 'Binance Hot Wallet 20' },
  { address: '0xbd612a3f30dca67bf60a39fd0d35e39b7ab80774', chain: 'bsc', label: 'Binance Hot Wallet 13' },
  { address: '0xeb2d2f1b8c558a40207669291fda468e50c8a0bb', chain: 'bsc', label: 'Binance Hot Wallet 10' },
  { address: '0x3c783c21a0383057d128bae431894a5c19f9cf06', chain: 'bsc', label: 'Binance Hot Wallet 8' },
  { address: '0x01c952174c24e1210d26961d456a77a39e1f0bb0', chain: 'bsc', label: 'Binance Hot Wallet 23' },
  { address: '0xf322942f644a996a617bd29c16bd7d231d9f35e9', chain: 'bsc', label: 'Venus Protocol Treasury' },
  { address: '0x53f78a071d04224b8e254e243fffc6d9f2f3fa23', chain: 'bsc', label: 'KuCoin Hot Wallet 2' },
  { address: '0xb1256d6b31e4ae87da1d56e5890c66be7f1c038e', chain: 'bsc', label: 'Binance Hot Wallet 2' },
  { address: '0x8ff804cc2143451f454779a40de386f913dcff20', chain: 'bsc', label: 'Binance Hot Wallet 4' },
  { address: '0xee5b5b923ffce93a870b3104b7ca09c3db80047a', chain: 'bsc', label: 'Bybit Hot Wallet 4' },
  { address: '0xcd5f3c15120a1021155174719ec5fcf2c75adf5b', chain: 'bsc', label: 'KuCoin Hot Wallet 1' },
  { address: '0x9ef34a9e740a74385c07e3030bebba2d562c7872', chain: 'bsc', label: 'BNB Whale 5' },
  { address: '0x0000000000000000000000000000000000001010', chain: 'polygon', label: 'Polygon POL Token' },
  { address: '0x4c569c1e541a19132ac893748e0ad54c7c989ff4', chain: 'polygon', label: 'Upbit Hot Wallet' },
  { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', chain: 'polygon', label: 'Wrapped POL' },
  { address: '0x7a8ed27f4c30512326878652d20fc85727401854', chain: 'polygon', label: 'Polygon Whale' },
  { address: '0x7d341e757f893e1a13d40370d0f6065ca9c4777e', chain: 'polygon', label: 'Polygon Whale 2' },
  { address: '0x68bd76deeb37c239c5d6d57f50bf32257546f7f2', chain: 'polygon', label: 'Polygon Whale 3' },
  { address: '0x71956a1cd5a4233177f7bf9a2d5778851e201934', chain: 'polygon', label: 'Bitstamp 43' },
  { address: '0x9b0c45d46d386cedd98873168c36efd0dcba8d46', chain: 'polygon', label: 'Revolut 3' },
  { address: '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245', chain: 'polygon', label: 'Binance 48' },
  { address: '0xf89d7b9c864f589bbf53a82105107622b35eaa40', chain: 'polygon', label: 'Bybit Hot Wallet' },
  { address: '0xfcbb9e5bb354b6f9fd40362cee043f510dd3028d', chain: 'polygon', label: 'Polygon Whale 4' },
  { address: '0x290275e3db66394c52272398959845170e4dcb88', chain: 'polygon', label: 'Binance 68' },
  { address: '0x0d0707963952f2fba59dd06f2b425ace40b492fe', chain: 'polygon', label: 'Gate.io Hot Wallet 1' },
  { address: '0xe8599f3cc5d38a9ad6f3684cd5cea72f10dbc383', chain: 'polygon', label: 'Aave Treasury Collector V3' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', chain: 'polygon', label: 'Binance Hot Wallet 20' },
  { address: '0x401f6c983ea34274ec46f84d70b31c151321188b', chain: 'polygon', label: 'Polygon Plasma Bridge' },
  { address: '0x131f001af400d5f212e1894846469fba70f8bcc9', chain: 'arbitrum', label: 'Bithumb 8' },
  { address: '0x82af49447D8a07e3bd95BD0d56f35241523fBab1', chain: 'arbitrum', label: 'Arbitrum WETH' },
  { address: '0x5a52e96bacdabb82fd05763e25335261b270efcb', chain: 'arbitrum', label: 'Binance 28' },
  { address: '0x3b87db6ded35ebd28ecbf8014fb325eef23f6c07', chain: 'arbitrum', label: 'Arbitrum Whale' },
  { address: '0x350b381e386bdec81cecb9f3c31dc0472cb44e4d', chain: 'arbitrum', label: 'Kraken Hot Wallet 2' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', chain: 'arbitrum', label: 'Binance Hot Wallet 20' },
  { address: '0xadfffc33cdc9970349cbcea3d73ec343d6ed116d', chain: 'arbitrum', label: 'Arbitrum Whale 2' },
  { address: '0xb38e8c17e38363af6ebdcb3dae12e0243582891d', chain: 'arbitrum', label: 'Binance 54' },
  { address: '0x1714400ff23db4af24f9fd64e7039e6597f18c2b', chain: 'arbitrum', label: 'Crypto.com 4' },
  { address: '0x9223c017a39d4806d1d92c15046ae28c32c6d8e7', chain: 'arbitrum', label: 'Binance US 7' },
  { address: '0x76ec5a0d3632b2133d9f1980903305b62678fbd3', chain: 'arbitrum', label: 'BtcTurk 13' },
  { address: '0x9d271a4e9523d74572b618ec10419a0a330e1bf0', chain: 'arbitrum', label: 'Bybit Hot Wallet 10' },
  { address: '0x7da0b9211020d3775b18116fe751c555b9a7058c', chain: 'arbitrum', label: 'Bybit 34' },
  { address: '0x3727cfcbd85390bb11b3ff421878123adb866be8', chain: 'arbitrum', label: 'Bitbank 2' },
  { address: '0x52aa899454998be5b000ad077a46bbe360f4e497', chain: 'arbitrum', label: 'Fluid Liquidity Proxy' },
  { address: '0xf89d7b9c864f589bbf53a82105107622b35eaa40', chain: 'arbitrum', label: 'Bybit Hot Wallet' },
  { address: '0x25681ab599b4e2ceea31f8b498052c53fc2d74db', chain: 'arbitrum', label: 'Binance 94' },
  { address: '0x360e68faccca8ca495c1b759fd9eee466db9fb32', chain: 'arbitrum', label: 'Uniswap V4 Pool Manager' },
  { address: '0xffa8db7b38579e6a2d14f9b347a9ace4d044cd54', chain: 'arbitrum', label: 'Bitget 35' },
  { address: '0xb86f1061e0d79e8319339d5fdbb187d4e7ad3300', chain: 'arbitrum', label: 'MEXC 30' },
  { address: '0x4200000000000000000000000000000000000016', chain: 'optimism', label: 'Optimism L2 To L1 Message Passer' },
  { address: '0x4200000000000000000000000000000000000006', chain: 'optimism', label: 'Optimism Wrapped Ether' },
  { address: '0x6f0cf3fda2af7e3c9772af76bd6b93f7602ca2be', chain: 'optimism', label: 'Optimism Whale' },
  { address: '0xc04f49c89058da65b443a66f9092d90912c2d95f', chain: 'optimism', label: 'Bithumb 407' },
  { address: '0x3727cfcbd85390bb11b3ff421878123adb866be8', chain: 'optimism', label: 'Bitbank 2' },
  { address: '0xc0e17ad342afabd36b3971f8305ff147006962ae', chain: 'optimism', label: 'Optimism Whale 2' },
  { address: '0x43c5b1c2be8ef194a509cf93eb1ab3dbd07b97ed', chain: 'optimism', label: 'Binance US 4' },
  { address: '0x1993bbe2b19dc40e8591ffa4d3d953a3578e27cf', chain: 'optimism', label: 'Optimism Whale 3' },
  { address: '0x6a9c2449c32779f89d0ccafd746152e237c1bdf2', chain: 'optimism', label: 'Optimism Whale 4' },
  { address: '0xf89d7b9c864f589bbf53a82105107622b35eaa40', chain: 'optimism', label: 'Bybit Hot Wallet' },
  { address: '0x5bdf85216ec1e38d6458c870992a69e38e03f7ef', chain: 'optimism', label: 'Bitget 5' },
  { address: '0x6d37817d118f72f362cf01e64d9454bdd8e8e92f', chain: 'optimism', label: 'Optimism Whale 5' },
  { address: '0xacd03d601e5bb1b275bb94076ff46ed9d753435a', chain: 'optimism', label: 'Binance 55' },
  { address: '0xd1c3ee17103289acbda421cbe5382a05507ae0ac', chain: 'optimism', label: 'Optimism Whale 6' },
  { address: '0x442689f3f26cbccc2e288daea986b9d67346149a', chain: 'optimism', label: 'Optimism Whale 7' },
  { address: '0x8d371bc560246dc632c4e707707d85d2e568a832', chain: 'optimism', label: 'OKX 173' },
  { address: '0xb5a9621b0397bfc5b45896cae5998b6111bcdce6', chain: 'optimism', label: 'Optimism Whale 8' },
  { address: '0x0b07f64abc342b68aec57c0936e4b6fd4452967e', chain: 'optimism', label: 'Optimism Whale 9' },
  { address: '0x7c43e0270c868d0341c636a38c07e5ae93908a04', chain: 'optimism', label: 'Optimism Whale 10' },
  { address: '0x91dca37856240e5e1906222ec79278b16420dc92', chain: 'optimism', label: 'Optimism Whale 11' },
  { address: '0x4200000000000000000000000000000000000006', chain: 'base', label: 'Base Wrapped Ether' },
  { address: '0xa7c0d36c4698981fab42a7d8c783674c6fe2592d', chain: 'base', label: 'Binance 74' },
  { address: '0x4200000000000000000000000000000000000016', chain: 'base', label: 'Base L2 To L1 Message Passer' },
  { address: '0xf977814e90da44bfa03b6295a0616a897441acec', chain: 'base', label: 'Binance Hot Wallet 20' },
  { address: '0x3304e22ddaa22bcdc5fca2269b418046ae7b566a', chain: 'base', label: 'Binance 73' },
  { address: '0xbaed383ede0e5d9d72430661f3285daa77e9439f', chain: 'base', label: 'Bybit Hot Wallet 6' },
  { address: '0xadfffc33cdc9970349cbcea3d73ec343d6ed116d', chain: 'base', label: 'Base Whale' },
  { address: '0x611f7bf868a6212f871e89f7e44684045ddfb09d', chain: 'base', label: 'Base Whale 2' },
  { address: '0x498581ff718922c3f8e6a244956af099b2652b2b', chain: 'base', label: 'Uniswap V4 Pool Manager' },
  { address: '0x7473899213aa6a3d321ecc2259f567ef1af2acb8', chain: 'base', label: 'Base Whale 3' },
  { address: '0x835678a611b28684005a5e2233695fb6cbbb0007', chain: 'base', label: 'Binance 70' },
  { address: '0xbad36f8edd1e2109baa37197c05074151a70cc05', chain: 'base', label: 'Base Whale 4' },
  { address: '0xb4807865a786e9e9e26e6a9610f2078e7fc507fb', chain: 'base', label: 'Coinbase 36' },
  { address: '0x39591e7c099a379fd7b349ebfecaeef439c40454', chain: 'base', label: 'OKX 177' },
  { address: '0x307576dd4f73f91bb8c4a2edb762938e8e067d31', chain: 'base', label: 'Base Whale 5' },
  { address: '0x97b9d2102a9a65a26e1ee82d59e42d1b73b68689', chain: 'base', label: 'Bitget 3' },
  { address: '0x52aa899454998be5b000ad077a46bbe360f4e497', chain: 'base', label: 'Fluid Liquidity Proxy' },
  { address: '0x3a263890a3a6b13a66acdaca75403d2e00ac9d2a', chain: 'base', label: 'Base Whale 6' },
  { address: '0xdc181bd607330aeebef6ea62e03e5e1fb4b6f7c7', chain: 'base', label: 'Stargate Pool Native' },
  { address: '0x564e82722bb9a4e46f48875c25de11aad310883e', chain: 'base', label: 'Base Whale 7' },
  { address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', chain: 'avalanche', label: 'Wrapped AVAX' },
  { address: '0x1d48963dd8fada6ab5c2c7b92eba81ecc5030270', chain: 'avalanche', label: 'Robinhood Cold Wallet' },
  { address: '0xefdc8fc1145ea88e3f5698ee7b7b432f083b4246', chain: 'avalanche', label: 'Upbit Hot Wallet 1' },
  { address: '0x98a90680f275ee23ba7b4b5f5f3917448550e9e6', chain: 'avalanche', label: 'Avalanche Whale' },
  { address: '0x4aefa39caeadd662ae31ab0ce7c8c2c9c0a013e8', chain: 'avalanche', label: 'Binance Cold Wallet 5' },
  { address: '0x15abb66ba754f05cbc0165a64a11cded1543de48', chain: 'avalanche', label: 'Avalanche Whale 2' },
  { address: '0x76ec5a0d3632b2133d9f1980903305b62678fbd3', chain: 'avalanche', label: 'BtcTurk Cold Wallet 1' },
  { address: '0x43684d03d81d3a4c70da68febdd61029d426f042', chain: 'avalanche', label: 'Binance Cold Wallet 2' },
  { address: '0x9f8c163cba728e99993abe7495f06c0a3c8ac8b9', chain: 'avalanche', label: 'Binance Hot Wallet 10' },
  { address: '0x3eb93b23a2dd4ced46e964f035ecea9bfb55bc73', chain: 'avalanche', label: 'Coinbase Cold Wallet' },
  { address: '0x346ff41c596937d3d196a7521e52930210068f6d', chain: 'avalanche', label: 'Bithumb Hot Wallet 12' },
  { address: '0xf89d7b9c864f589bbf53a82105107622b35eaa40', chain: 'avalanche', label: 'Bybit Hot Wallet 1' },
  { address: '0x0d0707963952f2fba59dd06f2b425ace40b492fe', chain: 'avalanche', label: 'Gate.io Hot Wallet 1' },
  { address: '0x4e75e27e5aa74f0c7a9d4897dc10ef651f3a3995', chain: 'avalanche', label: 'KuCoin Hot Wallet' },
  { address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', chain: 'solana', label: 'Alameda Research' },
  { address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', chain: 'solana', label: 'Binance 2' },
  { address: 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', chain: 'solana', label: 'Bybit Hot Wallet' },
  { address: 'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w', chain: 'solana', label: 'Gate.io' },
  { address: 'is6MTRHEgyFLNTfYcuV4QBWLjrZBfmhVNYR6ccgr8KV', chain: 'solana', label: 'OKX Hot Wallet 2' },
  { address: 'AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS', chain: 'solana', label: 'Crypto.com Hot Wallet 2' },
  { address: '53unSgGWqEWANcPYRF35B2Bgf8BkszUtcccKiXwGGLyr', chain: 'solana', label: 'Binance.US Hot Wallet' },
  { address: 'D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf', chain: 'solana', label: 'Coinbase Hot Wallet 3' },
  { address: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', chain: 'solana', label: 'Coinbase Hot Wallet 2' },
  { address: 'C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo', chain: 'solana', label: 'OKX Hot Wallet' },
  { address: 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', chain: 'solana', label: 'Binance Staking' },
  { address: 'mpa4abUkjQoAvPzREkh5Mo75hZhPFQ2FSH6w7dWKuQ5', chain: 'solana', label: 'Solana Foundation Delegation' },
  { address: 'H4yiPhdSsmSMJTznXzmZvdqWuhxDRzzkoQMEWXZ6agFZ', chain: 'solana', label: 'FTX / Alameda Staking' },
  { address: 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb', chain: 'tron', label: 'Binance Cold Wallet 2' },
  { address: 'TGn1uvntAVntT1pG8o7qoKkbViiYfeg6Gj', chain: 'tron', label: 'HTX Cold 4' },
  { address: 'TAuUCiH4JVNBZmDnEDZkXEUXDARdGpXTmX', chain: 'tron', label: 'HTX Cold 6' },
  { address: 'TH7vVF9RTMXM9x7ZnPnbNcEph734hpu8cf', chain: 'tron', label: 'HTX Cold 2' },
  { address: 'TRSXRWudzfzY4jH7AaMowdMNUXDkHisbcd', chain: 'tron', label: 'HTX Cold 3' },
  { address: 'TZ1SsapyhKNWaVLca6P2qgVzkHTdk6nkXa', chain: 'tron', label: 'HTX' },
  { address: 'TKgD8Qnx9Zw3DNvG6o83PkufnMbtEXis4T', chain: 'tron', label: 'HTX Cold 7' },
  { address: 'TYh6mgoMNZTCsgpYHBz7gttEfrQmDMABub', chain: 'tron', label: 'HTX Exchange' },
  { address: 'TF2fmSbg5HAD34KPUH7WtWCxxvgXHohzYM', chain: 'tron', label: 'HTX 2' },
  { address: 'THZovMcKoZaV9zzFTWteQYd2f3NEvnzxAM', chain: 'tron', label: 'HTX 3' },
  { address: 'TASUAUKXCqvwYjesEWv22pFjRsCeF4NKot', chain: 'tron', label: 'Upbit Hot Wallet' },
  { address: 'TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf', chain: 'tron', label: 'Binance Hot 7' },
  { address: 'TDToUxX8sH4z6moQpK3ZLAN24eupu2ivA4', chain: 'tron', label: 'HTX 6' },
  { address: 'TBA6CypYJizwA9XdC7Ubgc5F1bxrQ7SqPt', chain: 'tron', label: 'Gate.io' },
  { address: 'TEPSrSYPDSQ7yXpMFPq91Fb1QEWpMkRGfn', chain: 'tron', label: 'MEXC' },
  { address: 'TWpqsYjAw7rFPmWeZcwKQanCS6Kk8f5dhT', chain: 'tron', label: 'Bitpanda' },
  { address: 'TBfJhtGydsNkGt3VVN1mwcXLec9RExMRav', chain: 'tron', label: 'CoinSpot' },
  { address: 'TNaRAoLUyYEV2uF7GUrzSjRQTU8v5ZJ5VR', chain: 'tron', label: 'Binance Tron Hot' },
  { address: 'TCGVFGDd62LSrfZEaz3M3fYifWWdSDHRL8', chain: 'tron', label: 'VanEck' },
  { address: 'astro-stakers.poolv1.near', chain: 'near', label: 'Astro Stakers Pool' },
  { address: 'stakin.poolv1.near', chain: 'near', label: 'Stakin Staking Pool' },
  { address: 'stake1.poolv1.near', chain: 'near', label: 'Stake1 Staking Pool' },
  { address: 'aurora', chain: 'near', label: 'Aurora Engine' },
  { address: 'chorusone.poolv1.near', chain: 'near', label: 'Chorus One Staking Pool' },
  { address: 'npro.poolv1.near', chain: 'near', label: 'NPro Staking Pool' },
  { address: 'near', chain: 'near', label: 'NEAR Root Account' },
  { address: 'allnodes.poolv1.near', chain: 'near', label: 'Allnodes Staking Pool' },
  { address: 'blockdaemon.poolv1.near', chain: 'near', label: 'Blockdaemon Staking Pool' },
  { address: 'stakely_io.poolv1.near', chain: 'near', label: 'Stakely.io Staking Pool' },
  { address: 'operator.meta-pool.near', chain: 'near', label: 'Meta Pool Operator' },
];

/** Seeded wallets carry a `default-N` id; anything else in storage was added by the user. */
const SEED_ID_PREFIX = 'default-';

/**
 * Bumped whenever DEFAULT_WALLETS changes materially. Stored alongside the wallet list so an
 * existing user's stale seed set can be migrated forward — see loadTracked.
 *   1 → Reach's original 20 (Ethereum-heavy)
 *   2 → 173 wallets, ~20 per chain across all 10 chains
 */
export const SEED_VERSION = 2;
export const SEED_VERSION_KEY = 'ov_tracked_seed_version';

export function defaultWallets(): TrackedWallet[] {
  return DEFAULT_WALLETS.map((w, i) => ({ ...w, id: `${SEED_ID_PREFIX}${i}` }));
}

/**
 * Reads the tracked list, seeding the whale defaults **only when nothing has ever been stored**.
 * The distinction matters: Reach falls back to the defaults whenever the stored array is empty, so
 * a user who deliberately removes every wallet gets all 20 back on the next load and can never
 * reach an empty tracker. Here, an explicit stored `[]` is honoured as an empty list.
 *
 * When the seed set itself changes (SEED_VERSION), an existing user is holding the *old* whales in
 * localStorage and would otherwise never see the new ones. So the stale seeds are swapped for the
 * current set — but only the seeds: rows the user added themselves (no `default-` id) are preserved
 * verbatim, and a user who had deliberately deleted every wallet keeps their empty tracker rather
 * than having 173 wallets reappear.
 */
export function loadTracked(): TrackedWallet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TRACKED_KEY);
    if (raw === null) return defaultWallets(); // first visit — never stored
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultWallets();

    const stored = parsed.filter(
      (w): w is TrackedWallet =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as TrackedWallet).address === 'string' &&
        typeof (w as TrackedWallet).id === 'string' &&
        !!getChain((w as TrackedWallet).chain),
    );

    const seenVersion = Number(window.localStorage.getItem(SEED_VERSION_KEY) ?? '1');
    if (seenVersion >= SEED_VERSION) return stored;

    // Stale seed set: swap the old seeds for the current ones, keep everything the user added.
    //
    // Deliberately does NOT stamp SEED_VERSION here. loadTracked must stay a pure read — React
    // StrictMode double-invokes the effect that calls it, and a write here made the second call see
    // the new version, skip the migration, and hand back the *stale* list it had just replaced.
    // saveTracked owns the stamp, and the view persists right after loading.
    const userAdded = stored.filter((w) => !w.id.startsWith(SEED_ID_PREFIX));
    // An intentionally-emptied tracker stays empty — don't resurrect 173 wallets under them.
    if (stored.length === 0) return [];
    return [...defaultWallets(), ...userAdded];
  } catch {
    return defaultWallets();
  }
}

export function saveTracked(wallets: TrackedWallet[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRACKED_KEY, JSON.stringify(wallets));
    // Stamp the seed version on every write, so a first-time user (who was handed the current
    // defaults, not a migrated set) isn't treated as stale on their next visit.
    window.localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
  } catch {
    /* storage blocked — keep the in-memory list */
  }
}
