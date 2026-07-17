// CoinMarketCap source for the Reports feature.
//
// Deliberately a near-copy of the fetch layer in app/api/market/cmc/route.ts rather than an import:
// route files aren't modules you import (importing one drags `next/server` in and breaks plain-node
// testing), and the report needs a different slice of the data anyway — no sparklines, no pool
// quantising, just the listing plus a sentiment snapshot.
//
// Same constraints as that route: CMC's data-api/v3 is undocumented and keyless, rejects non-browser
// User-Agents, and sends no CORS headers — so this is server-side only, and every fetch fails soft.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 10_000;

/** Top 500 by market cap — the same pool the Gainers & Losers board ranks, and the same bound the
 *  gate's MAX_CMC_RANK assumes. */
const LISTING_SIZE = 500;

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

const thumbFor = (id: number) => `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png`;

/** Mirrors the Coin shape of app/api/market/cmc/route.ts so the gate reads the same field names. */
export interface Coin {
  id: number;
  cmcRank: number | null;
  symbol: string;
  name: string;
  slug: string;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  volume: number | null;
  marketCap: number | null;
  thumb: string;
}

interface RawListingCoin {
  id: number;
  cmcRank?: number;
  symbol?: string;
  name?: string;
  slug?: string;
  quotes?: {
    price?: number;
    percentChange1h?: number;
    percentChange24h?: number;
    percentChange7d?: number;
    percentChange30d?: number;
    volume24h?: number;
    marketCap?: number;
  }[];
}

function mapListingCoin(c: RawListingCoin): Coin {
  const q = c.quotes?.[0] ?? {};
  return {
    id: c.id,
    cmcRank: num(c.cmcRank),
    symbol: c.symbol ?? '',
    name: c.name ?? '',
    slug: c.slug ?? '',
    price: num(q.price),
    change1h: num(q.percentChange1h),
    change24h: num(q.percentChange24h),
    change7d: num(q.percentChange7d),
    change30d: num(q.percentChange30d),
    volume: num(q.volume24h),
    marketCap: num(q.marketCap),
    thumb: thumbFor(c.id),
  };
}

/**
 * The ranked coin pool. Always sorted by market cap upstream — CMC's listing offers no
 * sort-by-percent-change, so the caller ranks in-process (see gate.ts).
 */
export async function fetchListing(): Promise<Coin[]> {
  const url =
    `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing` +
    `?start=1&limit=${LISTING_SIZE}&sortBy=market_cap&sortType=desc&convert=USD` +
    `&cryptoType=all&tagType=all&audited=false`;
  const res = (await fetchJSON(url)) as { data?: { cryptoCurrencyList?: RawListingCoin[] } };
  return (res?.data?.cryptoCurrencyList ?? []).map(mapListingCoin);
}

/* ── Sentiment ──
 *
 * Stands in for the social/news read we don't have. X (Twitter) has no free tier, so the report
 * leans on what's free and already proven in this codebase: the Fear & Greed index, and CMC's own
 * trending / most-visited / recently-added lists — which are a genuine crowd-attention signal, just
 * a coarser one than social sentiment. See sentiment/x.ts for the seam where X would slot in. */

interface RawSpotlightCoin {
  symbol?: string;
}

async function fetchSpotlight(): Promise<{
  trending: string[];
  mostVisited: string[];
  recentlyAdded: string[];
}> {
  // dataType=7 → trending + mostVisited; dataType=8 → recentlyAdded. `limit` must be 5..30.
  const [spot, recent] = await Promise.all([
    fetchJSON('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/spotlight?dataType=7&limit=30'),
    fetchJSON('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/spotlight?dataType=8&limit=30'),
  ]);
  const s = spot as { data?: { trendingList?: RawSpotlightCoin[]; mostVisitedList?: RawSpotlightCoin[] } };
  const r = recent as { data?: { recentlyAddedList?: RawSpotlightCoin[] } };
  const syms = (list: RawSpotlightCoin[] | undefined) =>
    (list ?? []).map((c) => c.symbol ?? '').filter(Boolean);
  return {
    trending: syms(s?.data?.trendingList),
    mostVisited: syms(s?.data?.mostVisitedList),
    recentlyAdded: syms(r?.data?.recentlyAddedList),
  };
}

async function fetchFearGreed(): Promise<{ value: number; classification: string } | null> {
  const d = (await fetchJSON('https://api.alternative.me/fng/?limit=1')) as {
    data?: { value?: string; value_classification?: string }[];
  };
  const row = d?.data?.[0];
  const value = row?.value != null ? parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(value)) return null;
  return { value, classification: row?.value_classification ?? '' };
}

/** Sentiment snapshot. Each source fails soft — a dead endpoint costs one field, not the report. */
export async function fetchSentiment() {
  const [fearGreed, spotlight] = await Promise.all([
    fetchFearGreed().catch(() => null),
    fetchSpotlight().catch(() => ({ trending: [], mostVisited: [], recentlyAdded: [] })),
  ]);
  return { fearGreed, ...spotlight };
}
