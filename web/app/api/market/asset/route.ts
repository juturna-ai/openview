import { NextResponse } from 'next/server';
import {
  commodityDescription,
  etfDescription,
  stockDescription,
  type Description,
} from './descriptions';
import { hasTokenized, TOKENIZED, type TokenizedMarkets } from './tokenized';

// Per-asset detail — what a leaderboard row opens into. One route serves all four asset classes and
// normalises them onto a single payload, so the detail view renders from one shape rather than four.
//
// Sources (all keyless — no API key, no signup, same hosts the leaderboards already use):
//
//   crypto        CoinMarketCap's undocumented data-api/v3 `detail` (stats, supply, ATH/ATL, links,
//                 description) plus `detail/chart` for the price series. Same endpoints
//                 coinmarketcap.com's own frontend calls; they reject a request with no browser UA.
//
//   stocks / etfs Yahoo's chart endpoint for the price series and the live quote, plus Nasdaq's
//                 `quote/{sym}/summary` for the fundamentals Yahoo won't give up without a crumb —
//                 market cap, sector/industry, dividend yield, average volume, 52w range.
//
//   commodities   Yahoo only. A futures contract has no market cap, no sector and no dividend, so
//                 the payload simply omits them and the UI renders fewer stat tiles. Nothing is
//                 faked to fill a grid.
//
// Descriptions come from a third set of sources, one per class, and live in ./descriptions — see
// that file for why each class needs a different one (and why ETF copy is hardcoded).
//
// Markets: only crypto has a real per-venue table. Stocks, ETFs and commodities trade on a single
// listing venue, so they get `whereToBuy` instead — with one exception, in ./tokenized: a commodity
// with a gold-backed-token style proxy (XAU → XAUt) has a genuine CEX/DEX market in *that token*,
// which CMC publishes. That table is real, and the UI labels it as the token, not the future.
//
// Every upstream fails soft and independently: a dead Nasdaq must still leave a Yahoo-priced chart
// on screen. Responses are cached briefly so opening the same asset twice doesn't re-hit upstream.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
/** Bounded so a long session can't grow the cache without limit. */
const CACHE_MAX = 200;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export type AssetClass = 'crypto' | 'stocks' | 'etfs' | 'commodities';

/** The five chart windows the detail view offers. Each maps to a range on whichever upstream. */
export type Range = '24H' | '7D' | '1M' | '1Y' | 'ALL';
const RANGES: Range[] = ['24H', '7D', '1M', '1Y', 'ALL'];

/** One point on the price line: [unix seconds, price]. A tuple, not an object — this is the bulk of
 *  the payload and the naming would repeat once per point. */
export type Point = [number, number];

/** A labelled number the UI prints in the stats grid. `kind` picks the formatter. */
export interface Stat {
  label: string;
  value: number | null;
  kind: 'usd' | 'big' | 'pct' | 'num' | 'text';
  /** Only for kind 'text' — pre-formatted strings (sector, exchange, dates). */
  text?: string;
}

/**
 * One venue you can trade the asset on. **Crypto only** — see `WhereToBuy` for why the other classes
 * get something different.
 */
export interface MarketPair {
  exchange: string;
  /** CMC's exchange id, which keys its logo CDN. Null when the pair arrives without one. */
  exchangeId: number | null;
  pair: string;
  price: number | null;
  /** Buy-side / sell-side liquidity within 2% of mid. Null when CMC excludes the pair's depth. */
  depthPlus: number | null;
  depthMinus: number | null;
  volume: number | null;
  /** This pair's share of the asset's total 24h volume. */
  volumePct: number | null;
  /** 'cex' | 'dex' — the board lets you filter on it. */
  type: string;
  /** Deep link straight into the venue's trade screen. */
  url: string;
}

/**
 * Where you can buy a **stock, ETF or commodity** — deliberately NOT a `MarketPair[]`.
 *
 * Those assets have no market-pairs table and pretending otherwise would mean inventing data. AAPL
 * lists on exactly one venue (NasdaqGS); SPY on NYSEArca; gold futures on COMEX. Every broker fills
 * against the same consolidated quote, and no keyless source publishes per-broker price, depth or
 * volume — so a table with those columns would be fabricated.
 *
 * What *is* true and useful: the real listing venue (from Yahoo) and the fact that the mainstream
 * brokers carry it. The brokers are a fixed list, not a per-symbol lookup, and the UI says so.
 */
export interface WhereToBuy {
  /** The listing venue, e.g. "NasdaqGS" / "NYSEArca" / "COMEX". Real, from Yahoo's chart meta. */
  venue: string | null;
  currency: string | null;
  brokers: { label: string; url: string }[];
}

export interface AssetDetail {
  cls: AssetClass;
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  rank: number | null;
  /** Stats vary by class — the UI renders whatever arrives, in order, and nothing more. */
  stats: Stat[];
  /**
   * The About copy. Every class has one — crypto from CMC, stocks from Nasdaq, commodities from
   * Wikipedia, ETFs from a hand-written map.
   *
   * Internally tri-state (see `Description` in ./descriptions): a string, `''` when the source
   * genuinely has no copy, or **`null` when the fetch failed**. The handler uses that last case to
   * decide the payload isn't cacheable, then flattens it to `''` before it reaches the client — so
   * the wire format is always a string and the UI never sees null.
   */
  description: Description;
  /** Label → URL. Crypto gets website/whitepaper/explorer/source; equities get their Nasdaq page. */
  links: { label: string; url: string }[];
  chart: Point[];
  /** Which range `chart` covers — echoed back so the client can't mislabel a fallback series. */
  range: Range;
  /** Crypto only: the venues it trades on. Empty for every other class. */
  markets: MarketPair[];
  /** Total number of pairs upstream, which is far more than `markets` returns. */
  marketCount: number;
  /** Rows per page, so the client can derive the page count from `marketCount`. */
  marketPageSize: number;
  /** Non-crypto only: the listing venue + brokers. Null for crypto, which has `markets` instead. */
  whereToBuy: WhereToBuy | null;
  /**
   * A commodity's tokenized proxy and its real CEX/DEX pairs — currently gold, via XAUt. Null for
   * every other asset, which is the common case: this is an addition to `whereToBuy`, not a
   * replacement, because the token is a *different instrument* from the future above it.
   */
  tokenized: TokenizedMarkets | null;
  updatedAt: number;
}

/* ── Crypto: CoinMarketCap data-api/v3 ── */

interface CmcStats {
  price?: number;
  priceChangePercentage24h?: number;
  marketCap?: number;
  fullyDilutedMarketCap?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  maxSupply?: number;
  marketCapDominance?: number;
  rank?: number;
  volume24h?: number;
  low24h?: number;
  high24h?: number;
  lowAllTime?: number;
  highAllTime?: number;
  highAllTimeTimestamp?: string;
}

interface CmcDetail {
  data?: {
    id?: number;
    name?: string;
    symbol?: string;
    slug?: string;
    description?: string;
    dateAdded?: string;
    statistics?: CmcStats;
    urls?: Record<string, string[]>;
  };
}

/* ── Crypto markets: which venues actually trade the coin ── */

interface RawMarketPair {
  exchangeName?: string;
  exchangeId?: number;
  marketPair?: string;
  price?: number;
  volumeUsd?: number;
  volumePercent?: number;
  depthUsdPositiveTwo?: number;
  depthUsdNegativeTwo?: number;
  marketUrl?: string;
  category?: string;
  centerType?: string;
  /** CMC flags pairs whose price/volume it distrusts; those are excluded from its own averages. */
  outlierDetected?: number;
  priceExcluded?: number;
  volumeExcluded?: number;
}

interface CmcMarkets {
  data?: { numMarketPairs?: number; marketPairs?: RawMarketPair[] };
}

/** Rows per page of the markets table. BTC alone has ~2,100 pairs, so this is paged, not dumped.
 *  Echoed to the client as `marketPageSize` — it drives the page count and the rank offset, so the
 *  two must not diverge. Change it here only. */
const MARKET_LIMIT = 10;

/**
 * The venues trading a coin, ranked by CMC's liquidity-aware order (`cmc_rank_advanced`) — the same
 * ordering coinmarketcap.com shows, which puts deep, trustworthy pairs first rather than whichever
 * venue self-reports the biggest number.
 *
 * Keyed by `slug`, not id — this is the one CMC endpoint that insists on it.
 *
 * `page` is 1-based. Note the returned row count can come in *under* MARKET_LIMIT: the outlier
 * filter below runs after CMC has already paginated, so a page containing excluded pairs yields
 * fewer rows. That's deliberate — padding the page would mean showing prices CMC itself distrusts.
 */
async function cryptoMarkets(
  slug: string,
  page = 1,
): Promise<{ pairs: MarketPair[]; total: number }> {
  const start = (Math.max(1, page) - 1) * MARKET_LIMIT + 1;

  const res = (await fetchJSON(
    `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest` +
      `?slug=${encodeURIComponent(slug)}&start=${start}&limit=${MARKET_LIMIT}` +
      `&category=spot&centerType=all&sort=cmc_rank_advanced`,
  )) as CmcMarkets;

  const pairs = (res?.data?.marketPairs ?? [])
    // Drop the pairs CMC itself flags as outliers — it excludes them from the coin's headline price
    // and volume, so showing them here would contradict the number in the page header.
    .filter((p) => !p.outlierDetected && !p.priceExcluded)
    .map(
      (p): MarketPair => ({
        exchange: p.exchangeName ?? '',
        // CMC serves an exchange logo per id off the same CDN as the coin icons. Null when the pair
        // arrives without an id, which the client renders as an initial-letter fallback.
        exchangeId: p.exchangeId ?? null,
        pair: p.marketPair ?? '',
        price: num(p.price),
        depthPlus: num(p.depthUsdPositiveTwo),
        depthMinus: num(p.depthUsdNegativeTwo),
        // A volume-excluded pair still has a real price; only its volume is untrustworthy.
        volume: p.volumeExcluded ? null : num(p.volumeUsd),
        volumePct: p.volumeExcluded ? null : num(p.volumePercent),
        type: p.centerType ?? p.category ?? '',
        url: p.marketUrl ?? '',
      }),
    )
    .filter((p) => p.exchange && p.pair);

  return { pairs, total: num(res?.data?.numMarketPairs) ?? pairs.length };
}

/** CMC's chart payload is a map of unix-second → { v: [price, volume, marketCap, ...] }. */
interface CmcChart {
  data?: { points?: Record<string, { v?: number[] }> };
}

/** CMC's own range tokens. "ALL" is what its All tab sends. */
const CMC_RANGE: Record<Range, string> = {
  '24H': '1D',
  '7D': '7D',
  '1M': '1M',
  '1Y': '1Y',
  ALL: 'ALL',
};

/** CMC's description is markdown with inline links; the UI renders plain paragraphs, so strip the
 *  markup rather than ship a markdown renderer for one field. Headings become their own paragraph. */
function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/^#{1,6}\s*/gm, '') // ## Heading → Heading
    .replace(/[*_`>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** ISO timestamp → "Oct 6, 2025". Null-safe: a missing date just drops the tile's suffix. */
const fmtDate = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? undefined
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const CMC_LINK_LABELS: Record<string, string> = {
  website: 'Website',
  technical_doc: 'Whitepaper',
  explorer: 'Explorer',
  source_code: 'Source code',
};

async function cryptoDetail(id: number, range: Range, mktPage = 1): Promise<AssetDetail> {
  // The chart is the bigger, slower call and the one most likely to fail — fetch both together and
  // let the chart come back empty rather than block the stats behind it.
  //
  // Markets is a third call that can't be launched with the other two: it keys off the coin's
  // `slug`, which only the detail response knows. Chaining it off that promise (rather than awaiting
  // the Promise.all first) still lets it overlap the chart, so the request costs two round-trips,
  // not three.
  const detailP = fetchJSON(
    `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?id=${id}`,
  ) as Promise<CmcDetail>;

  const marketsP = detailP
    .then((r) => {
      const slug = r?.data?.slug;
      return slug ? cryptoMarkets(slug, mktPage) : { pairs: [], total: 0 };
    })
    // Markets are supplementary — a failure costs the table, never the page.
    .catch(() => ({ pairs: [] as MarketPair[], total: 0 }));

  const [detail, chart, markets] = await Promise.all([
    detailP,
    fetchJSON(
      `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail/chart?id=${id}&range=${CMC_RANGE[range]}`,
    ).catch(() => ({}) as CmcChart) as Promise<CmcChart>,
    marketsP,
  ]);

  const d = detail?.data ?? {};
  const s = d.statistics ?? {};

  const points: Point[] = Object.entries(chart?.data?.points ?? {})
    .map(([t, p]): Point => [Number(t), p?.v?.[0] ?? NaN])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);

  const athDate = fmtDate(s.highAllTimeTimestamp);

  const links = Object.entries(d.urls ?? {})
    .filter(([k, v]) => CMC_LINK_LABELS[k] && v?.[0])
    .map(([k, v]) => ({ label: CMC_LINK_LABELS[k], url: v[0] }));

  return {
    cls: 'crypto',
    symbol: d.symbol ?? '',
    name: d.name ?? '',
    price: num(s.price),
    change24h: num(s.priceChangePercentage24h),
    rank: num(s.rank),
    stats: [
      { label: 'Market Cap', value: num(s.marketCap), kind: 'big' },
      { label: 'Volume (24h)', value: num(s.volume24h), kind: 'big' },
      { label: 'Fully Diluted Cap', value: num(s.fullyDilutedMarketCap), kind: 'big' },
      { label: 'Dominance', value: num(s.marketCapDominance), kind: 'pct' },
      { label: 'Circulating Supply', value: num(s.circulatingSupply), kind: 'num' },
      { label: 'Total Supply', value: num(s.totalSupply), kind: 'num' },
      { label: 'Max Supply', value: num(s.maxSupply), kind: 'num' },
      { label: '24h Low', value: num(s.low24h), kind: 'usd' },
      { label: '24h High', value: num(s.high24h), kind: 'usd' },
      {
        label: athDate ? `All-Time High (${athDate})` : 'All-Time High',
        value: num(s.highAllTime),
        kind: 'usd',
      },
      { label: 'All-Time Low', value: num(s.lowAllTime), kind: 'usd' },
    ],
    description: d.description ? stripMarkdown(d.description) : '',
    links,
    chart: points,
    range,
    markets: markets.pairs,
    marketCount: markets.total,
    marketPageSize: MARKET_LIMIT,
    // Crypto has a real markets table, so it doesn't need the broker fallback.
    whereToBuy: null,
    // A coin *is* the traded instrument — there's no proxy to substitute for it.
    tokenized: null,
    updatedAt: Date.now(),
  };
}

/**
 * The tokenized proxy's market pairs — gold's XAUt today. Reuses `cryptoMarkets` verbatim, because
 * the token genuinely *is* a CMC-listed crypto asset: same endpoint, same outlier filtering, same
 * liquidity ordering. The only thing that differs is the story the UI tells around the table.
 *
 * Supplementary like every other market fetch: a failure costs the panel, never the page.
 */
async function tokenizedMarkets(symbol: string, page: number): Promise<TokenizedMarkets | null> {
  const t = TOKENIZED[symbol];
  if (!t) return null;

  try {
    const { pairs, total } = await cryptoMarkets(t.slug, page);
    if (!pairs.length) return null;

    return { token: t.token, tokenName: t.tokenName, backing: t.backing, pairs, total };
  } catch {
    return null;
  }
}

/* ── Stocks / ETFs / commodities: Yahoo chart + Nasdaq summary ── */

interface YahooChart {
  chart?: {
    result?: {
      meta?: Record<string, number | string>;
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

/**
 * Yahoo range + candle interval per window. Intraday needs a fine interval; a multi-decade window
 * needs a coarse one, or the response would be tens of thousands of points for a line a few hundred
 * pixels wide.
 *
 * ALL asks for monthly bars because that is what Yahoo returns for `range=max` whatever interval you
 * request — asking for 1wk and getting 1mo back would just make the request a lie. 168 monthly bars
 * covers Apple back to its 1984 listing.
 */
const YAHOO_RANGE: Record<Range, { range: string; interval: string }> = {
  '24H': { range: '1d', interval: '5m' },
  '7D': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  ALL: { range: 'max', interval: '1mo' },
};

async function yahooSeries(
  ticker: string,
  range: Range,
): Promise<{ points: Point[]; meta: Record<string, number | string> }> {
  const { range: r, interval } = YAHOO_RANGE[range];
  const d = (await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${r}`,
  )) as YahooChart;

  const res = d?.chart?.result?.[0];
  const ts = res?.timestamp ?? [];
  const closes = res?.indicators?.quote?.[0]?.close ?? [];

  // Yahoo pads gaps (holidays, halted sessions) with nulls — drop them rather than draw to zero.
  const points: Point[] = ts
    .map((t, i): Point => [t, closes[i] ?? NaN])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));

  return { points, meta: res?.meta ?? {} };
}

/**
 * The live price and the *prior session's* close.
 *
 * This is a separate request from the display series, and it has to be. Yahoo's
 * `meta.chartPreviousClose` is the close preceding the **requested range**, not the previous day —
 * on a 1Y chart it's the price a year ago. Deriving a "24h change" from it made the number scale
 * with whichever chart window happened to be open (Gold read +1368% on the All range, AAPL +9.9% on
 * 1M). Pinning this to a fixed 5d/1d window makes 24h change and Previous Close mean the same thing
 * on every range, which is what those two fields claim to be.
 *
 * 5d rather than 2d because a holiday weekend can leave a 2-day window holding a single session,
 * which would leave nothing to compare against.
 */
async function yahooQuote(ticker: string): Promise<{ price: number | null; prev: number | null }> {
  const d = (await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
  )) as YahooChart;

  const res = d?.chart?.result?.[0];
  const meta = res?.meta ?? {};
  const closes = (res?.indicators?.quote?.[0]?.close ?? []).filter(
    (c): c is number => typeof c === 'number' && Number.isFinite(c),
  );

  const price = num(meta.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
  // On a 5d window `chartPreviousClose` really is the day before the window, so prefer the last
  // *completed* session inside it — closes[-2], the bar before today's.
  const prev = closes.length >= 2 ? closes[closes.length - 2] : num(meta.chartPreviousClose);

  return { price, prev };
}

/** Nasdaq's summary is a map of key → { label, value }, every value a display string. */
type NasdaqSummary = { data?: { summaryData?: Record<string, { value?: string }> | null } };

/** "4,698,925,805,080" / "$315.32" / "0.34%" → a number. Non-numeric ("N/A") → null. */
const parseNum = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function nasdaqSummary(
  symbol: string,
  assetclass: 'stocks' | 'etf',
): Promise<Record<string, string>> {
  const d = (await fetchJSON(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=${assetclass}`,
  )) as NasdaqSummary;
  const raw = d?.data?.summaryData ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (v?.value) out[k] = v.value;
  return out;
}

/** Ranked commodity metadata, mirroring the screener's table so a futures row keeps its display
 *  name ("Gold", not the contract's "Gold Aug 26") and its Yahoo ticker. */
const COMMODITY_TICKERS: Record<string, { ticker: string; name: string }> = {
  XAU: { ticker: 'GC=F', name: 'Gold' },
  XAG: { ticker: 'SI=F', name: 'Silver' },
  XPT: { ticker: 'PL=F', name: 'Platinum' },
  XPD: { ticker: 'PA=F', name: 'Palladium' },
  HG: { ticker: 'HG=F', name: 'Copper' },
  CL: { ticker: 'CL=F', name: 'Crude Oil (WTI)' },
  BZ: { ticker: 'BZ=F', name: 'Brent Crude Oil' },
  NG: { ticker: 'NG=F', name: 'Natural Gas' },
  RB: { ticker: 'RB=F', name: 'Gasoline (RBOB)' },
  ZC: { ticker: 'ZC=F', name: 'Corn' },
  ZW: { ticker: 'ZW=F', name: 'Wheat' },
  ZS: { ticker: 'ZS=F', name: 'Soybeans' },
  SB: { ticker: 'SB=F', name: 'Sugar #11' },
  KC: { ticker: 'KC=F', name: 'Coffee' },
  CT: { ticker: 'CT=F', name: 'Cotton' },
  LE: { ticker: 'LE=F', name: 'Live Cattle' },
};

/**
 * Nasdaq's screener writes a share class with a slash ("BRK/B"); Yahoo's chart endpoint wants a dash
 * ("BRK-B") and 404s on the slash. Without this, every share-class row on the stocks leaderboard was
 * a dead click. The icon layer already normalises the same way — see `baseTicker` in marketIcons.ts.
 */
const yahooTicker = (symbol: string) => symbol.replace(/\//g, '-');

/**
 * Brokers that carry the class — a **generic** list, not a per-symbol lookup, and the UI labels it as
 * such. No keyless source publishes which brokers hold which ticker, so the alternative to being
 * upfront about this would be implying a per-symbol check we never made.
 *
 * Split by class because the venues genuinely differ: a cash-equity broker like Robinhood doesn't
 * give you a COMEX gold future. Commodities therefore point at futures brokers, and at the ETFs that
 * are how most people actually get the exposure.
 */
const BROKERS: Record<Exclude<AssetClass, 'crypto'>, { label: string; url: string }[]> = {
  stocks: [
    { label: 'Fidelity', url: 'https://www.fidelity.com' },
    { label: 'Charles Schwab', url: 'https://www.schwab.com' },
    { label: 'Interactive Brokers', url: 'https://www.interactivebrokers.com' },
    { label: 'Robinhood', url: 'https://robinhood.com' },
    { label: 'E*TRADE', url: 'https://us.etrade.com' },
  ],
  etfs: [
    { label: 'Fidelity', url: 'https://www.fidelity.com' },
    { label: 'Vanguard', url: 'https://investor.vanguard.com' },
    { label: 'Charles Schwab', url: 'https://www.schwab.com' },
    { label: 'Interactive Brokers', url: 'https://www.interactivebrokers.com' },
    { label: 'Robinhood', url: 'https://robinhood.com' },
  ],
  commodities: [
    { label: 'Interactive Brokers', url: 'https://www.interactivebrokers.com' },
    { label: 'CME Group', url: 'https://www.cmegroup.com' },
    { label: 'TradeStation', url: 'https://www.tradestation.com' },
    { label: 'Charles Schwab (futures)', url: 'https://www.schwab.com/futures' },
  ],
};

/**
 * Stocks, ETFs and commodities all price off the same Yahoo series; they differ only in which extra
 * stats exist. `fallbackName` is the leaderboard's own name for the row, used when Yahoo's shortName
 * is a contract label or missing entirely.
 */
async function marketDetail(
  cls: Exclude<AssetClass, 'crypto'>,
  symbol: string,
  range: Range,
  fallbackName: string,
  mktPage = 1,
): Promise<AssetDetail> {
  const isCommodity = cls === 'commodities';
  const ticker = isCommodity
    ? (COMMODITY_TICKERS[symbol]?.ticker ?? symbol)
    : yahooTicker(symbol);

  // Every independent upstream in one wave. The quote is what makes the header correct on every
  // range (see yahooQuote); Nasdaq's summary is optional — a failure there costs a few stat tiles,
  // not the page — and the series is the chart itself.
  //
  // The last two are the new ones. Both are supplementary and both already fail soft internally
  // (returning '' / null rather than throwing), so neither can take the page down, and running them
  // here rather than sequentially means the About copy and the tokenized table cost no extra
  // round-trip — the request is still gated by whichever upstream is slowest, not by their sum.
  const [series, quote, summary, description, tokenized] = await Promise.all([
    yahooSeries(ticker, range),
    yahooQuote(ticker).catch(() => ({ price: null, prev: null })),
    isCommodity
      ? Promise.resolve({} as Record<string, string>)
      : nasdaqSummary(symbol, cls === 'etfs' ? 'etf' : 'stocks').catch(
          () => ({}) as Record<string, string>,
        ),
    // One class, one source — see ./descriptions for why they can't share.
    cls === 'stocks'
      ? stockDescription(symbol)
      : cls === 'etfs'
        ? Promise.resolve(etfDescription(symbol))
        : commodityDescription(symbol),
    hasTokenized(cls, symbol) ? tokenizedMarkets(symbol, mktPage) : Promise.resolve(null),
  ]);

  const { points, meta } = series;
  const price = quote.price ?? num(meta.regularMarketPrice);
  const prev = quote.prev ?? parseNum(summary.PreviousClose);
  const change24h = price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;

  // A futures contract's shortName is the contract, not the commodity ("Gold Aug 26"), so
  // commodities always take the curated name.
  const name = isCommodity
    ? (COMMODITY_TICKERS[symbol]?.name ?? (fallbackName || symbol))
    : fallbackName || (typeof meta.shortName === 'string' ? meta.shortName : symbol);

  // 52w range: Yahoo's meta carries it for every instrument, Nasdaq only for equities — prefer
  // Yahoo so commodities get it too.
  const week52High = num(meta.fiftyTwoWeekHigh);
  const week52Low = num(meta.fiftyTwoWeekLow);

  const stats: Stat[] = [];

  if (!isCommodity) {
    stats.push({ label: 'Market Cap', value: parseNum(summary.MarketCap), kind: 'big' });
  }
  stats.push(
    { label: 'Volume', value: num(meta.regularMarketVolume), kind: 'num' },
    { label: 'Previous Close', value: prev, kind: 'usd' },
    { label: 'Day Low', value: num(meta.regularMarketDayLow), kind: 'usd' },
    { label: 'Day High', value: num(meta.regularMarketDayHigh), kind: 'usd' },
    { label: '52W Low', value: week52Low, kind: 'usd' },
    { label: '52W High', value: week52High, kind: 'usd' },
  );

  if (!isCommodity) {
    // Only pushed when Nasdaq actually answered — a missing sector should drop the tile, not print
    // a dash where a value belongs.
    stats.push({ label: 'Avg Volume', value: parseNum(summary.AverageVolume), kind: 'num' });
    if (summary.Yield) stats.push({ label: 'Dividend Yield', value: parseNum(summary.Yield), kind: 'pct' });
    if (summary.OneYrTarget)
      stats.push({ label: '1Y Target', value: parseNum(summary.OneYrTarget), kind: 'usd' });
    if (summary.Sector)
      stats.push({ label: 'Sector', value: null, kind: 'text', text: summary.Sector });
    if (summary.Industry)
      stats.push({ label: 'Industry', value: null, kind: 'text', text: summary.Industry });
  }

  // The listing venue moved out of the stats grid and into the Where-to-buy panel, where it answers
  // an actual question ("traded on…") rather than sitting as one more anonymous tile.
  const venue = typeof meta.fullExchangeName === 'string' ? meta.fullExchangeName : null;

  const links = isCommodity
    ? []
    : [
        {
          label: 'Nasdaq profile',
          url: `https://www.nasdaq.com/market-activity/${cls === 'etfs' ? 'etf' : 'stocks'}/${symbol.toLowerCase()}`,
        },
      ];

  return {
    cls,
    symbol,
    name,
    price,
    change24h,
    rank: null,
    stats,
    description,
    links,
    chart: points,
    range,
    // No markets table for the asset *itself*: it trades on one venue, and no keyless source
    // publishes per-broker price or depth. See the WhereToBuy doc comment. Where a real market does
    // exist — in a tokenized proxy — it arrives via `tokenized` below, kept separate precisely so
    // it can't be mistaken for a market in the underlying.
    markets: [],
    marketCount: 0,
    marketPageSize: MARKET_LIMIT,
    whereToBuy: {
      venue,
      currency: typeof meta.currency === 'string' ? meta.currency : null,
      brokers: BROKERS[cls],
    },
    tokenized,
    updatedAt: Date.now(),
  };
}

/* ── Handler ── */

const cache = new Map<string, { at: number; payload: AssetDetail }>();

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const cls = q.get('cls') as AssetClass | null;
  const symbol = (q.get('symbol') ?? '').trim().toUpperCase();
  const id = Number(q.get('id'));
  const rangeRaw = (q.get('range') ?? '7D').toUpperCase() as Range;
  const range = RANGES.includes(rangeRaw) ? rangeRaw : '7D';
  const name = (q.get('name') ?? '').slice(0, 80);
  // 1-based page of the markets table. Clamped so a hand-edited URL can't walk off into huge offsets.
  const mktPageRaw = Number(q.get('mktPage') ?? '1');
  const mktPage = Number.isFinite(mktPageRaw) ? Math.min(Math.max(1, Math.trunc(mktPageRaw)), 500) : 1;

  if (!cls || !['crypto', 'stocks', 'etfs', 'commodities'].includes(cls)) {
    return NextResponse.json({ error: 'bad cls' }, { status: 400 });
  }
  // Crypto keys off CMC's numeric id; everything else off a ticker. Both are validated here so a
  // caller can't push arbitrary text into an upstream URL.
  if (cls === 'crypto' ? !Number.isFinite(id) || id <= 0 : !/^[A-Z0-9.\-/]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 });
  }

  // The markets page is part of the key: page 2 is a different payload from page 1, and without this
  // a page-flip would be served the cached first page.
  const key = `${cls}:${cls === 'crypto' ? id : symbol}:${range}:${mktPage}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json(hit.payload);

  try {
    const payload =
      cls === 'crypto'
        ? await cryptoDetail(id, range, mktPage)
        : await marketDetail(cls, symbol, range, name, mktPage);

    // A `null` description means the description upstream *failed*, not that the asset has none (see
    // the `Description` type). Caching that would pin a blank About section on the page for the full
    // TTL even after the upstream recovered — an observed bug: Wikipedia timed out on a cold start
    // and gold rendered with no About section for 60 s. Skip the write and the next request retries.
    //
    // A legitimately empty description ('' — an unlisted ETF) is a real answer and still caches, so
    // this doesn't turn every description-less asset into a permanent cache miss.
    if (payload.description !== null) {
      // Evict oldest-inserted first (Map preserves insertion order) so the cache stays bounded.
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, { at: Date.now(), payload });
    }

    // The null/'' distinction is internal to the cache — the client just renders no About section
    // either way, and shouldn't have to know the difference.
    return NextResponse.json({ ...payload, description: payload.description ?? '' });
  } catch {
    // Never leak an upstream error string — it can carry the URL we called.
    return NextResponse.json({ error: 'upstream unavailable' }, { status: 502 });
  }
}
