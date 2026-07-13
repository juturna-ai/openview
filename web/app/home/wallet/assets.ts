// Asset catalog — ported from Reach's src/data/assetCatalog.js.
//
// Reach resolves an asset's colour and logo on demand from its symbol + the asset type (the active
// tab), rather than storing either on the catalog entry. Kept that way here.
//
// The four metals use Reach's bundled animated coin .gifs, copied to /public/metals. Reach imports
// them through Vite under their original Tibia sprite names, with a mapping that is *not* the
// obvious one — its XAG points at Platinum_Coin.gif and its XPT at Crystal_Coin.gif (the Tibia
// platinum coin reads as silver, the crystal coin as platinum). That indirection is resolved here
// at the filename: each file is named for the metal it depicts, so the code below stays literal.
//
// `metalSvg()` is kept as the fallback for any metal without artwork.

export type AssetType = 'crypto' | 'stock' | 'metal' | 'currency';

export interface CatalogAsset {
  symbol: string;
  name: string;
}

// ── Brand colours ──
const BRAND_COLORS: Record<string, string> = {
  // Crypto
  BTC: '#f7931a', ETH: '#627eea', BNB: '#f3ba2f', XRP: '#23292f',
  SOL: '#9945FF', DOGE: '#c2a633', ADA: '#0033AD', TRX: '#EF0027',
  LINK: '#375BD2', XLM: '#000000', LTC: '#bfbbbb', AVAX: '#e84142',
  SHIB: '#fda32b', DOT: '#e6007a', UNI: '#FF007A', ATOM: '#2E3148',
  NEAR: '#000000', ETC: '#328332', ICP: '#29abe2', FIL: '#0090ff',
  HBAR: '#000000', APT: '#4cd080', ARB: '#28a0f0', OP: '#ff0420',
  VET: '#15bdff', ALGO: '#000000', AAVE: '#b6509e', INJ: '#00f2fe',
  MATIC: '#8247e5', SEI: '#9B1B30',
  MKR: '#1aab9b', GRT: '#6747ED', RNDR: '#000000', SUI: '#4da2ff',
  TON: '#0098EA', PEPE: '#4b8b3b', THETA: '#2ab8e6', SAND: '#04adef',
  MANA: '#ff2d55', AXS: '#0055d5', ENJ: '#624dbf', BAT: '#ff5000',
  ZEC: '#f4b728', XMR: '#ff6600', DASH: '#008ce7', NEO: '#00e599',
  COMP: '#00d395', SNX: '#170659', CRV: '#a2a2a2', FTM: '#1969ff',
  CAKE: '#d1884f', GALA: '#000000', APE: '#0054f9', RUNE: '#33ff99',
  DYDX: '#6966ff', FLOW: '#00ef8b', KAVA: '#ff564f', EOS: '#000000',
  BCH: '#8dc351', PAXG: '#e4ce4d', YFI: '#006ae3', SUSHI: '#d65892',
  UMA: '#ff4a4a', BAL: '#1e1e1e',
  // Stablecoins
  USDT: '#26a17b', USDC: '#2775ca', DAI: '#f5ac37', TUSD: '#002868',
  // Stocks
  AAPL: '#555555', MSFT: '#00a4ef', GOOGL: '#4285f4', AMZN: '#ff9900',
  TSLA: '#cc0000', META: '#0668e1', NVDA: '#76b900', JPM: '#004b8d',
  V: '#1a1f71', MA: '#eb001b', NFLX: '#e50914', DIS: '#0050aa',
  AMD: '#ed1c24', INTC: '#0071c5', WMT: '#0071dc', BA: '#0033a0',
  GS: '#6f9fd8', CRM: '#00a1e0', ADBE: '#ff0000', NKE: '#111111',
  KO: '#f40000', PYPL: '#003087', COIN: '#0052ff', PLTR: '#101010',
  // Metals
  XAU: '#FFD700', XAG: '#C0C0C0', XPT: '#e5e4e2', XPD: '#CED0DD',
  // Currencies
  EUR: '#003399', GBP: '#012169', JPY: '#bc002d', MXN: '#006847',
  CAD: '#ff0000', AUD: '#00008b', CHF: '#d52b1e', CNY: '#de2910',
  BRL: '#009b3a', KRW: '#003478',
};

/** Deterministic fallback colour for symbols with no brand entry. */
function hashColor(sym: string): string {
  let h = 0;
  for (const c of sym) h = c.charCodeAt(0) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 50%)`;
}

export function getAssetColor(symbol: string): string {
  return BRAND_COLORS[symbol] || hashColor(symbol);
}

// ── Stock logos: Google's favicon service, keyed by a hand-curated domain map ──
const STOCK_DOMAINS: Record<string, string> = {
  // ETFs + MSTR — used by the market page's Stocks & ETFs tab. Without a domain here the favicon
  // lookup returns null and the row falls back to a bare letter chip.
  SPY: 'ssga.com', QQQ: 'invesco.com', IWM: 'ishares.com',
  GLD: 'spdrgoldshares.com', MSTR: 'strategy.com',
  AAPL: 'apple.com', MSFT: 'microsoft.com', GOOGL: 'google.com',
  AMZN: 'amazon.com', TSLA: 'tesla.com', META: 'meta.com',
  NVDA: 'nvidia.com', JPM: 'jpmorganchase.com', V: 'visa.com',
  MA: 'mastercard.com', JNJ: 'jnj.com', WMT: 'walmart.com',
  PG: 'pg.com', UNH: 'unitedhealthgroup.com', HD: 'homedepot.com',
  DIS: 'disney.com', NFLX: 'netflix.com', PYPL: 'paypal.com',
  AMD: 'amd.com', INTC: 'intel.com', BA: 'boeing.com',
  GS: 'goldmansachs.com', IBM: 'ibm.com', ORCL: 'oracle.com',
  CRM: 'salesforce.com', ADBE: 'adobe.com', CSCO: 'cisco.com',
  PFE: 'pfizer.com', MRK: 'merck.com', ABBV: 'abbvie.com',
  XOM: 'exxonmobil.com', CVX: 'chevron.com', KO: 'coca-cola.com',
  PEP: 'pepsico.com', MCD: 'mcdonalds.com', NKE: 'nike.com',
  SBUX: 'starbucks.com', T: 'att.com', VZ: 'verizon.com',
  GM: 'gm.com', F: 'ford.com', UBER: 'uber.com',
  SQ: 'squareup.com', COIN: 'coinbase.com', PLTR: 'palantir.com',
  SNAP: 'snap.com', RBLX: 'roblox.com', SHOP: 'shopify.com',
  SPOT: 'spotify.com', ZM: 'zoom.us',
};

// ── Currency → ISO country code, for flag images ──
const CURRENCY_FLAGS: Record<string, string> = {
  EUR: 'eu', GBP: 'gb', JPY: 'jp', MXN: 'mx',
  CAD: 'ca', AUD: 'au', CHF: 'ch', CNY: 'cn',
  BRL: 'br', KRW: 'kr',
};

/** Builds a metallic coin as an inline SVG data-URI — no binary asset needed. */
function metalSvg(
  text: string, light: string, mid: string, dark: string,
  rim: string, textDark: string, textLight: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="bg" cx="35%" cy="30%" r="65%"><stop offset="0%" stop-color="${light}"/><stop offset="40%" stop-color="${mid}"/><stop offset="100%" stop-color="${dark}"/></radialGradient><linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${light}"/><stop offset="50%" stop-color="${rim}"/><stop offset="100%" stop-color="${light}"/></linearGradient><radialGradient id="sh" cx="30%" cy="25%" r="35%"><stop offset="0%" stop-color="white" stop-opacity="0.55"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="50" cy="50" r="48" fill="url(#bg)"/><circle cx="50" cy="50" r="46" fill="none" stroke="url(#rim)" stroke-width="2"/><circle cx="50" cy="50" r="40" fill="none" stroke="${rim}" stroke-width="0.5" opacity="0.25"/><circle cx="44" cy="40" r="28" fill="url(#sh)"/><text x="50" y="57" text-anchor="middle" font-size="26" font-weight="700" fill="${textLight}" font-family="system-ui,sans-serif" letter-spacing="1" opacity="0.35">${text}</text><text x="50" y="58" text-anchor="middle" font-size="26" font-weight="700" fill="${textDark}" font-family="system-ui,sans-serif" letter-spacing="1">${text}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* Inline-SVG coins — the fallback if a .gif ever fails to load. */
const METAL_SVGS: Record<string, string> = {
  XAU: metalSvg('Au', '#fff0a0', '#ffd700', '#b8860b', '#c9a840', '#7a5c00', '#fff8dc'),
  XAG: metalSvg('Ag', '#f8f8f8', '#c0c0c0', '#606060', '#909090', '#383838', '#e8e8e8'),
  XPT: metalSvg('Pt', '#ffffff', '#c8ccd8', '#2e3448', '#7880a0', '#1a2038', '#f0f2ff'),
  XPD: metalSvg('Pd', '#e4e8f0', '#a8b0c0', '#485060', '#687888', '#303848', '#d0d4e0'),
};

/* Reach's animated coin sprites. 32×32, ~7KB for all four. */
const METAL_LOGOS: Record<string, string> = {
  XAU: '/metals/gold.gif',
  XAG: '/metals/silver.gif',
  XPT: '/metals/platinum.gif',
  XPD: '/metals/palladium.gif',
};

// CoinCap keys its icons by asset id, not ticker — override the ones that differ.
const COINCAP_ID_MAP: Record<string, string> = {
  MATIC: 'matic-network', SEI: 'sei-network', BNB: 'binance-coin', SHIB: 'shiba-inu',
  NEAR: 'near-protocol', ICP: 'internet-computer', APT: 'aptos', ARB: 'arbitrum',
  OP: 'optimism', INJ: 'injective-protocol', IMX: 'immutable-x', STX: 'stacks',
  GRT: 'the-graph', RNDR: 'render-token', FET: 'fetch', TON: 'toncoin',
  PEPE: 'pepe', KAS: 'kaspa', SUI: 'sui', BAT: 'basic-attention-token',
  SAND: 'the-sandbox', MANA: 'decentraland', AXS: 'axie-infinity', LDO: 'lido-dao',
  ONE: 'harmony', APE: 'apecoin', RUNE: 'thorchain', CAKE: 'pancakeswap',
  JASMY: 'jasmycoin', EGLD: 'elrond', FLOKI: 'floki-inu', BCH: 'bitcoin-cash',
  ETC: 'ethereum-classic', HBAR: 'hedera-hashgraph', SNX: 'synthetix-network-token',
  HOT: 'holo', PAXG: 'pax-gold', OCEAN: 'ocean-protocol', WOO: 'woo-network',
  VET: 'vechain', FTM: 'fantom', YFI: 'yearn-finance', SUSHI: 'sushi',
  OMG: 'omisego', SC: 'siacoin', ZEN: 'zencash', AR: 'arweave',
  TAO: 'bittensor', WLD: 'worldcoin', RVN: 'ravencoin', FLUX: 'zelcash',
  RPL: 'rocket-pool', FXS: 'frax-share', SLP: 'smooth-love-potion', DYDX: 'dydx',
  CFX: 'conflux-network', CRV: 'curve-dao-token', MKR: 'maker', LRC: 'loopring',
  XTZ: 'tezos', BONK: 'bonk', JUP: 'jupiter',
};

/** True when the logo is a real image that should not sit on a coloured chip (flags, metal coins). */
export function hasLogoOverride(symbol: string, assetType: AssetType): boolean {
  if (assetType === 'metal') return !!METAL_LOGOS[symbol] || !!METAL_SVGS[symbol];
  if (assetType === 'currency') return !!CURRENCY_FLAGS[symbol];
  return false;
}

export function getLogoUrl(symbol: string, assetType: AssetType): string | null {
  if (assetType === 'crypto') {
    const id = COINCAP_ID_MAP[symbol] || symbol.toLowerCase();
    return `https://assets.coincap.io/assets/icons/${id}@2x.png`;
  }
  if (assetType === 'stock') {
    const domain = STOCK_DOMAINS[symbol];
    return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;
  }
  if (assetType === 'metal') return METAL_LOGOS[symbol] || METAL_SVGS[symbol] || null;
  if (assetType === 'currency') {
    const code = CURRENCY_FLAGS[symbol];
    return code ? `https://flagcdn.com/w80/${code}.png` : null;
  }
  return null;
}

/** The inline-SVG coin for a metal — used if its .gif fails to load. */
export function getMetalFallbackUrl(symbol: string): string | null {
  return METAL_SVGS[symbol] || null;
}

/** Secondary CDN, tried once when the CoinCap icon 404s. */
export function getCryptoFallbackUrl(symbol: string): string {
  return `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@latest/svg/color/${symbol.toLowerCase()}.svg`;
}

// ── Fallback glyph, shown on a coloured chip when no logo loads ──
const ICON_CHARS: Record<string, string> = {
  BTC: '₿', ETH: 'Ξ',
  XAU: 'Au', XAG: 'Ag', XPT: 'Pt', XPD: 'Pd',
  EUR: '€', GBP: '£', JPY: '¥', MXN: '$',
  CAD: 'C$', AUD: 'A$', CHF: 'Fr', CNY: '¥', BRL: 'R$', KRW: '₩',
};

export function getIconChar(symbol: string): string {
  return ICON_CHARS[symbol] || symbol.charAt(0);
}

// ── Catalogs ──

const CRYPTO_RAW: [string, string][] = [
  ['BTC', 'Bitcoin'], ['ETH', 'Ethereum'], ['BNB', 'BNB'], ['XRP', 'XRP'],
  ['SOL', 'Solana'], ['DOGE', 'Dogecoin'], ['ADA', 'Cardano'], ['TRX', 'TRON'],
  ['LINK', 'Chainlink'], ['XLM', 'Stellar'], ['LTC', 'Litecoin'], ['AVAX', 'Avalanche'],
  ['SHIB', 'Shiba Inu'], ['DOT', 'Polkadot'], ['UNI', 'Uniswap'], ['ATOM', 'Cosmos'],
  ['NEAR', 'NEAR Protocol'], ['ETC', 'Ethereum Classic'], ['ICP', 'Internet Computer'], ['FIL', 'Filecoin'],
  ['HBAR', 'Hedera'], ['APT', 'Aptos'], ['ARB', 'Arbitrum'], ['OP', 'Optimism'],
  ['MATIC', 'Polygon'], ['VET', 'VeChain'], ['ALGO', 'Algorand'], ['QNT', 'Quant'], ['AAVE', 'Aave'],
  ['INJ', 'Injective'], ['IMX', 'Immutable'], ['STX', 'Stacks'], ['CHZ', 'Chiliz'],
  ['CRV', 'Curve DAO'], ['MKR', 'Maker'], ['GRT', 'The Graph'], ['RNDR', 'Render'],
  ['FET', 'Fetch.ai'], ['SUI', 'Sui'], ['TON', 'Toncoin'], ['PEPE', 'Pepe'],
  ['WLD', 'Worldcoin'], ['ONDO', 'Ondo'], ['SEI', 'Sei'], ['JUP', 'Jupiter'],
  ['BONK', 'Bonk'], ['KAS', 'Kaspa'], ['THETA', 'Theta'], ['TAO', 'Bittensor'],
  ['FLOKI', 'Floki'], ['PENGU', 'Pudgy Penguins'],
  ['ENJ', 'Enjin'], ['BAT', 'Basic Attention Token'], ['ZEC', 'Zcash'], ['XMR', 'Monero'],
  ['DASH', 'Dash'], ['NEO', 'Neo'], ['WAVES', 'Waves'], ['ZIL', 'Zilliqa'],
  ['SAND', 'The Sandbox'], ['MANA', 'Decentraland'], ['AXS', 'Axie Infinity'], ['COMP', 'Compound'],
  ['SNX', 'Synthetix'], ['LDO', 'Lido DAO'], ['ONE', 'Harmony'], ['ONT', 'Ontology'],
  ['ZRX', '0x'], ['KNC', 'Kyber Network'], ['BAND', 'Band Protocol'], ['LRC', 'Loopring'],
  ['STORJ', 'Storj'], ['NMR', 'Numeraire'], ['OXT', 'Orchid'], ['SKL', 'SKALE'],
  ['ANKR', 'Ankr'], ['RSR', 'Reserve Rights'], ['GALA', 'Gala'], ['APE', 'ApeCoin'],
  ['GMT', 'GMT'], ['OMG', 'OMG Network'], ['IOST', 'IOST'], ['QTUM', 'Qtum'],
  ['ICX', 'ICON'], ['SC', 'Siacoin'], ['ZEN', 'Horizen'], ['CELO', 'Celo'],
  ['RUNE', 'THORChain'], ['CAKE', 'PancakeSwap'], ['DYDX', 'dYdX'], ['JASMY', 'JasmyCoin'],
  ['MASK', 'Mask Network'], ['FLOW', 'Flow'], ['MINA', 'Mina'], ['ROSE', 'Oasis'],
  ['EGLD', 'MultiversX'], ['IOTX', 'IoTeX'], ['AR', 'Arweave'], ['AUDIO', 'Audius'],
  ['EOS', 'EOS'], ['KAVA', 'Kava'],
  ['FTM', 'Fantom'], ['SXP', 'Solar'], ['YFI', 'Yearn.finance'], ['SUSHI', 'SushiSwap'],
  ['UMA', 'UMA'], ['BAL', 'Balancer'], ['FXS', 'Frax Share'], ['RPL', 'Rocket Pool'],
  ['ACH', 'Alchemy Pay'], ['BNT', 'Bancor'], ['REN', 'Ren'], ['REQ', 'Request'],
  ['FUN', 'FUNToken'], ['HOT', 'Holo'], ['MTL', 'Metal'], ['CELR', 'Celer'],
  ['DENT', 'Dent'], ['SYS', 'Syscoin'], ['BLZ', 'Bluzelle'], ['CVC', 'Civic'],
  ['NKN', 'NKN'], ['RLC', 'iExec'], ['CTSI', 'Cartesi'], ['ALICE', 'MyNeighborAlice'],
  ['TLM', 'Alien Worlds'], ['SUPER', 'SuperVerse'], ['PEOPLE', 'ConstitutionDAO'], ['LINA', 'Linear'],
  ['RVN', 'Ravencoin'], ['FLUX', 'Flux'], ['COTI', 'COTI'], ['OGN', 'Origin'],
  ['SLP', 'Smooth Love Potion'], ['C98', 'Coin98'], ['AGLD', 'Adventure Gold'], ['HIGH', 'Highstreet'],
  ['DAR', 'Mines of Dalarnia'], ['BCH', 'Bitcoin Cash'], ['PAXG', 'PAX Gold'], ['XVS', 'Venus'],
  ['RAD', 'Radicle'], ['SPELL', 'Spell Token'], ['POND', 'Marlin'], ['AMP', 'Amp'],
  ['GTC', 'Gitcoin'], ['IDEX', 'IDEX'], ['BADGER', 'Badger DAO'], ['MLN', 'Enzyme'],
  ['OCEAN', 'Ocean Protocol'], ['LOOM', 'Loom Network'],
  ['SSV', 'SSV Network'], ['EDU', 'Open Campus'], ['HOOK', 'Hooked Protocol'], ['MAV', 'Maverick'],
  ['TRU', 'TrueFi'], ['LEVER', 'LeverFi'], ['UNFI', 'Unifi Protocol'], ['BAKE', 'BakeryToken'],
  ['XTZ', 'Tezos'], ['BLUR', 'Blur'], ['WOO', 'WOO Network'], ['ARKM', 'Arkham'],
  ['ORDI', 'ORDI'], ['CFX', 'Conflux'], ['PERP', 'Perpetual Protocol'], ['RAY', 'Raydium'],
  ['FIDA', 'Bonfida'], ['MDT', 'Measurable Data'], ['KEY', 'SelfKey'], ['PROM', 'Prom'],
  ['BETA', 'Beta Finance'], ['PHB', 'Phoenix'], ['VOXEL', 'Voxies'], ['LIT', 'Litentry'],
  ['ARPA', 'ARPA'], ['STMX', 'StormX'], ['IOTA', 'IOTA'], ['LUNC', 'Terra Classic'],
  ['WBTC', 'Wrapped Bitcoin'], ['USDT', 'Tether'], ['USDC', 'USD Coin'], ['DAI', 'Dai'],
  ['MNT', 'Mantle'], ['CRO', 'Cronos'], ['TUSD', 'TrueUSD'], ['DGB', 'DigiByte'],
  ['DCR', 'Decred'], ['LSK', 'Lisk'], ['POLY', 'Polymath'], ['XEM', 'NEM'],
  ['BTT', 'BitTorrent'], ['WIN', 'WINkLink'], ['1INCH', '1inch'],
  ['ALPHA', 'Alpha Venture DAO'], ['DUSK', 'Dusk'], ['NULS', 'NULS'],
  ['STEEM', 'Steem'], ['WAN', 'Wanchain'], ['DOCK', 'Dock'],
  ['ERN', 'Ethernity'], ['RARE', 'SuperRare'], ['BSV', 'Bitcoin SV'],
];

const STOCK_RAW: [string, string][] = [
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['GOOGL', 'Alphabet'], ['AMZN', 'Amazon'],
  ['TSLA', 'Tesla'], ['META', 'Meta'], ['NVDA', 'NVIDIA'], ['JPM', 'JPMorgan Chase'],
  ['V', 'Visa'], ['MA', 'Mastercard'], ['JNJ', 'Johnson & Johnson'], ['WMT', 'Walmart'],
  ['PG', 'Procter & Gamble'], ['UNH', 'UnitedHealth'], ['HD', 'Home Depot'], ['DIS', 'Disney'],
  ['NFLX', 'Netflix'], ['PYPL', 'PayPal'], ['AMD', 'AMD'], ['INTC', 'Intel'],
  ['BA', 'Boeing'], ['GS', 'Goldman Sachs'], ['IBM', 'IBM'], ['ORCL', 'Oracle'],
  ['CRM', 'Salesforce'], ['ADBE', 'Adobe'], ['CSCO', 'Cisco'], ['PFE', 'Pfizer'],
  ['MRK', 'Merck'], ['ABBV', 'AbbVie'], ['XOM', 'ExxonMobil'], ['CVX', 'Chevron'],
  ['KO', 'Coca-Cola'], ['PEP', 'PepsiCo'], ['MCD', "McDonald's"], ['NKE', 'Nike'],
  ['SBUX', 'Starbucks'], ['T', 'AT&T'], ['VZ', 'Verizon'], ['GM', 'General Motors'],
  ['F', 'Ford'], ['UBER', 'Uber'], ['SQ', 'Block'], ['COIN', 'Coinbase'],
  ['PLTR', 'Palantir'], ['SNAP', 'Snap'], ['RBLX', 'Roblox'], ['SHOP', 'Shopify'],
  ['SPOT', 'Spotify'], ['ZM', 'Zoom'],
];

export const METAL_LIST: CatalogAsset[] = [
  { symbol: 'XAU', name: 'Gold' },
  { symbol: 'XAG', name: 'Silver' },
  { symbol: 'XPT', name: 'Platinum' },
  { symbol: 'XPD', name: 'Palladium' },
];

export const CURRENCY_LIST: CatalogAsset[] = [
  { symbol: 'EUR', name: 'Euro' },
  { symbol: 'GBP', name: 'British Pound' },
  { symbol: 'JPY', name: 'Japanese Yen' },
  { symbol: 'MXN', name: 'Mexican Peso' },
  { symbol: 'CAD', name: 'Canadian Dollar' },
  { symbol: 'AUD', name: 'Australian Dollar' },
  { symbol: 'CHF', name: 'Swiss Franc' },
  { symbol: 'CNY', name: 'Chinese Yuan' },
  { symbol: 'BRL', name: 'Brazilian Real' },
  { symbol: 'KRW', name: 'Korean Won' },
];

export const ASSET_CATALOG: Record<AssetType, CatalogAsset[]> = {
  crypto: CRYPTO_RAW.map(([symbol, name]) => ({ symbol, name })),
  stock: STOCK_RAW.map(([symbol, name]) => ({ symbol, name })),
  metal: METAL_LIST,
  currency: CURRENCY_LIST,
};

export const TYPE_TABS: { id: AssetType; label: string }[] = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'stock', label: 'Stocks' },
  { id: 'metal', label: 'Metals' },
  { id: 'currency', label: 'Currencies' },
];

/** Looks up an asset's display name; falls back to the symbol for anything not cataloged. */
export function getAssetName(symbol: string, assetType: AssetType): string {
  return ASSET_CATALOG[assetType]?.find((a) => a.symbol === symbol)?.name || symbol;
}

// ── Shared formatters (Reach defines these per-component; centralised here) ──

/** Absolute USD — callers prepend their own sign, matching Reach. */
export function fmtUsd(v: number, d = 2): string {
  return (
    '$' +
    Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
  );
}

/** Price, widening to 8 decimals for sub-$1 assets so micro-caps don't all read $0.00. */
export function fmtPrice(p: number): string {
  return (
    '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: p < 1 ? 8 : 2 })
  );
}
