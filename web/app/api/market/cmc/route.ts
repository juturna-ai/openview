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
  circulatingSupply: number | null;
  maxSupply: number | null;
  thumb: string;
  /** 7-day closing prices for the row sparkline; empty until the chart fetch fills it in. */
  sparkline7d: number[];
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
  circulatingSupply?: number;
  maxSupply?: number;
  totalSupply?: number;
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
    circulatingSupply: num(c.circulatingSupply),
    // Coins with no hard cap (uncapped supply) report maxSupply 0 upstream — treat that as "no cap"
    // so the supply bar shows as full rather than dividing by zero.
    maxSupply: num(c.maxSupply) && (c.maxSupply as number) > 0 ? num(c.maxSupply) : null,
    thumb: thumbFor(c.id),
    sparkline7d: [],
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

/* ── 7d sparklines ──
 *
 * The listing endpoint carries no price history — only a single 7d %. CMC's own frontend draws each
 * row's mini-chart from a per-coin chart call, so we do the same, but only for the coins that fit on
 * the leaderboard's first page (SPARKLINE_COUNT) — fetching 500 charts every poll would hammer
 * upstream and get rate-limited. Each series is downsampled to keep the payload light, and the whole
 * map is cached on a longer TTL than the listing (7d shape barely moves minute-to-minute). */

const SPARKLINE_COUNT = 100;
const SPARKLINE_POINTS = 24;
const SPARKLINE_TTL_MS = 5 * 60_000;
const SPARKLINE_CONCURRENCY = 8;

let sparklineCache: { at: number; map: Record<number, number[]> } | null = null;

async function fetchSparkline(id: number): Promise<number[]> {
  const url = `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail/chart?id=${id}&range=7D`;
  const res = (await fetchJSON(url)) as { data?: { points?: Record<string, { v?: number[] }> } };
  const points = res?.data?.points ?? {};
  const times = Object.keys(points).sort((a, b) => Number(a) - Number(b));
  const prices: number[] = [];
  for (const t of times) {
    const v = points[t]?.v?.[0];
    if (typeof v === 'number' && Number.isFinite(v)) prices.push(v);
  }
  if (prices.length <= SPARKLINE_POINTS) return prices;
  const step = Math.ceil(prices.length / SPARKLINE_POINTS);
  const out: number[] = [];
  for (let i = 0; i < prices.length; i += step) out.push(prices[i]);
  if (out[out.length - 1] !== prices[prices.length - 1]) out.push(prices[prices.length - 1]);
  return out;
}

/** Fetch 7d sparklines for the first-page coins, capped concurrency, failing soft per coin. */
async function fetchSparklines(ids: number[]): Promise<Record<number, number[]>> {
  const map: Record<number, number[]> = {};
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        map[id] = await fetchSparkline(id);
      } catch {
        // A dead chart just leaves that row without a sparkline — never blank the whole board.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SPARKLINE_CONCURRENCY, ids.length) }, worker));
  return map;
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
    circulatingSupply: null,
    maxSupply: null,
    thumb: thumbFor(c.id),
    sparkline7d: [],
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

  // 7d sparklines for the first-page coins, on their own longer TTL so the every-30s listing poll
  // doesn't re-fetch 100 charts each time. Reuses the last map on a cache hit (or on failure).
  if (coins.length > 0) {
    const now = Date.now();
    if (!sparklineCache || now - sparklineCache.at >= SPARKLINE_TTL_MS) {
      const topIds = coins.slice(0, SPARKLINE_COUNT).map((c) => c.id);
      const map = await fetchSparklines(topIds).catch(() => ({} as Record<number, number[]>));
      // Don't overwrite a good map with a total failure — keep the previous series on screen.
      if (Object.keys(map).length > 0 || !sparklineCache) sparklineCache = { at: now, map };
    }
    const map = sparklineCache?.map ?? {};
    for (const c of coins) {
      const s = map[c.id];
      if (s) c.sparkline7d = s;
    }
  }

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
