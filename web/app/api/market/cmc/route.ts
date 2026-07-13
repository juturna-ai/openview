import { NextResponse } from 'next/server';

// CoinMarketCap proxy — powers the six crypto tabs on the Gainers & Losers page.
//
// Ported from Reach's electron/main.js (`quant:gainersLosers`, `quant:cmcSpotlight`,
// `quant:fearGreed`). Reach uses **no API key**: it calls CMC's undocumented `data-api/v3`
// endpoints — the same ones coinmarketcap.com's own frontend uses. They reject requests without a
// browser User-Agent, hence the UA header below.
//
// This must be server-side, not just because CLAUDE.md forbids calling external APIs from the
// browser, but because CMC's data-api sends no CORS headers — a fetch from the client would be
// blocked outright.
//
// Caveat worth knowing: data-api/v3 is undocumented and can change or rate-limit without notice.
// Every fetch therefore fails soft (empty lists, never a throw), and results are cached so the
// client's 30s poll doesn't hammer upstream.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

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

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const thumbFor = (id: number) =>
  `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png`;

/* ── listing: the ranked coin list (gainers/losers, leaderboards, sentiment all derive from this) ── */

interface RawListingCoin {
  id: number;
  cmcRank?: number;
  symbol?: string;
  name?: string;
  slug?: string;
  quotes?: { price?: number; percentChange1h?: number; percentChange24h?: number; percentChange7d?: number; percentChange30d?: number; volume24h?: number; marketCap?: number }[];
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

async function fetchListing(limit: number): Promise<Coin[]> {
  const url =
    `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing` +
    `?start=1&limit=${limit}&sortBy=market_cap&sortType=desc&convert=USD` +
    `&cryptoType=all&tagType=all&audited=false`;
  const res = (await fetchJSON(url)) as { data?: { cryptoCurrencyList?: RawListingCoin[] } };
  return (res?.data?.cryptoCurrencyList ?? []).map(mapListingCoin);
}

/* ── spotlight: trending / most visited / recently added ── */

interface RawSpotlightCoin {
  id: number;
  rank?: number;
  symbol?: string;
  name?: string;
  slug?: string;
  marketCap?: number;
  selfReportedMarketCap?: number;
  priceChange?: {
    price?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    priceChange7d?: number;
    priceChange30d?: number;
    volume24h?: number;
  };
}

function mapSpotlightCoin(c: RawSpotlightCoin): Coin {
  const p = c.priceChange ?? {};
  return {
    id: c.id,
    cmcRank: num(c.rank),
    symbol: c.symbol ?? '',
    name: c.name ?? '',
    slug: c.slug ?? '',
    price: num(p.price),
    change1h: num(p.priceChange1h),
    change24h: num(p.priceChange24h),
    change7d: num(p.priceChange7d),
    change30d: num(p.priceChange30d),
    volume: num(p.volume24h),
    marketCap: num(c.marketCap) ?? num(c.selfReportedMarketCap),
    thumb: thumbFor(c.id),
  };
}

async function fetchSpotlight(): Promise<{
  trending: Coin[];
  mostVisited: Coin[];
  recentlyAdded: Coin[];
}> {
  // dataType=7 returns trending + mostVisited (+ gainer/loser, which we derive from `listing`
  // instead so they honour the timeframe/pool controls). dataType=8 returns recentlyAdded.
  // `limit` is validated upstream to 5..30 — anything outside that range 400s.
  const [spot, recent] = await Promise.all([
    fetchJSON('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/spotlight?dataType=7&limit=30'),
    fetchJSON('https://api.coinmarketcap.com/data-api/v3/cryptocurrency/spotlight?dataType=8&limit=30'),
  ]);
  const s = spot as { data?: { trendingList?: RawSpotlightCoin[]; mostVisitedList?: RawSpotlightCoin[] } };
  const r = recent as { data?: { recentlyAddedList?: RawSpotlightCoin[] } };
  return {
    trending: (s?.data?.trendingList ?? []).map(mapSpotlightCoin),
    mostVisited: (s?.data?.mostVisitedList ?? []).map(mapSpotlightCoin),
    recentlyAdded: (r?.data?.recentlyAddedList ?? []).map(mapSpotlightCoin),
  };
}

/* ── Fear & Greed (alternative.me, keyless) ── */

export interface FearGreed {
  value: number;
  classification: string;
}

async function fetchFearGreed(): Promise<FearGreed | null> {
  const d = (await fetchJSON('https://api.alternative.me/fng/?limit=1')) as {
    data?: { value?: string; value_classification?: string }[];
  };
  const row = d?.data?.[0];
  const value = row?.value != null ? parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(value)) return null;
  return { value, classification: row?.value_classification ?? '' };
}

/* ── Handler ── */

export interface CmcPayload {
  coins: Coin[];
  trending: Coin[];
  mostVisited: Coin[];
  recentlyAdded: Coin[];
  fearGreed: FearGreed | null;
  updatedAt: number;
}

// Keyed by pool size — "Top 100" and "All" fetch different list lengths.
const cache = new Map<number, { at: number; payload: CmcPayload }>();

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get('limit'));
  // Clamp: a caller-supplied limit must never let the client ask CMC for an unbounded list.
  const limit = Number.isFinite(raw) ? Math.min(1000, Math.max(100, Math.trunc(raw))) : 500;

  const hit = cache.get(limit);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.payload);
  }

  // Each source fails independently — one dead endpoint must not blank the whole page.
  const [coins, spotlight, fearGreed] = await Promise.all([
    fetchListing(limit).catch(() => [] as Coin[]),
    fetchSpotlight().catch(() => ({ trending: [], mostVisited: [], recentlyAdded: [] })),
    fetchFearGreed().catch(() => null),
  ]);

  const payload: CmcPayload = {
    coins,
    ...spotlight,
    fearGreed,
    updatedAt: Date.now(),
  };

  // Don't cache a total wipeout — a transient upstream blip would otherwise stick for the full TTL.
  if (coins.length > 0 || spotlight.trending.length > 0) {
    cache.set(limit, { at: Date.now(), payload });
  }

  return NextResponse.json(payload);
}
