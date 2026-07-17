import { NextResponse } from 'next/server';

// Symbol → logo map for the chart engine's watchlist / search icons.
//
// Why this exists: the engine derived every coin icon from CoinCap's icon CDN keyed by the
// lowercased base ticker (`assets.coincap.io/assets/icons/<base>@2x.png`). That URL only resolves
// for coins whose CoinCap id happens to equal their ticker, so anything newly listed or long-tail
// 404'd and fell back to a letter circle. Measured against MEXC's top 60 pairs by 24h volume, 21
// of 60 had no icon — a third of the visible list.
//
// Source: CoinMarketCap's keyless `data-api/v3` listing — the same undocumented endpoints the
// existing `api/market/cmc` route already uses (see that file for the UA / no-CORS rationale).
// Paging market-cap desc to LISTING_DEPTH yields a symbol → numeric-id map; the id keys CMC's
// static logo CDN, which serves every listed coin including the ones CoinCap never had.
//
// Served from the server, not baked into index.html, because the engine is a static file with no
// build step — a ~4.6k-entry map belongs behind a cached fetch, not in the first-paint payload.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 15_000;
// Logos change about as often as a coin rebrands; a long TTL keeps this to a few upstream passes
// per server instance per day.
const CACHE_TTL_MS = 6 * 3600_000;

// Ranks 1..LISTING_DEPTH, in pages of PAGE_SIZE. CMC's listing currently ends around rank ~8.2k —
// pages past the end simply return an empty list, so this is deliberately set beyond it to take the
// whole thing (~7k distinct tickers) rather than truncate the long tail a full venue catalog hits.
// Measured: depth 5000 → 4618 symbols, full depth → 6990.
//
// Raising it further buys nothing: coins past CMC's end aren't listed at all (verified — the last
// stragglers on MEXC's top-200 resolve on no source at any depth), and those correctly fall through
// to the letter circle.
const LISTING_DEPTH = 10_000;
const PAGE_SIZE = 1000;

interface RawCoin {
  id: number;
  symbol?: string;
  rank?: number;
  cmcRank?: number;
}

async function fetchPage(start: number): Promise<RawCoin[]> {
  const url =
    `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing` +
    `?start=${start}&limit=${PAGE_SIZE}&sortBy=market_cap&sortType=desc&convert=USD` +
    `&cryptoType=all&tagType=all&audited=false`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { data?: { cryptoCurrencyList?: RawCoin[] } };
  return j?.data?.cryptoCurrencyList ?? [];
}

export interface CoinLogoPayload {
  /** Logo CDN prefix; the engine builds `${base}${id}${ext}`. */
  base: string;
  ext: string;
  /** UPPERCASE ticker → CMC numeric id. */
  ids: Record<string, number>;
  updatedAt: number;
}

let cache: { at: number; payload: CoinLogoPayload } | null = null;
// Single-flight, same rationale as api/market/cmc: a cold cache under concurrent loads would
// otherwise fire five 1000-coin listing passes per caller.
let inflight: Promise<CoinLogoPayload> | null = null;

// Cap parallel upstream calls — firing all ten pages at once is a burst CMC may rate-limit, and
// this runs a handful of times a day at most, so a couple of extra round-trips costs nothing.
const PAGE_CONCURRENCY = 3;

async function build(): Promise<CoinLogoPayload> {
  const starts: number[] = [];
  for (let s = 1; s <= LISTING_DEPTH; s += PAGE_SIZE) starts.push(s);

  // Pages fail independently — a dead page costs its slice of the tail, never the whole map.
  // Ordered results, so the market-cap-desc precedence below still holds.
  const pages: RawCoin[][] = new Array(starts.length);
  let next = 0;
  async function worker() {
    while (next < starts.length) {
      const i = next++;
      pages[i] = await fetchPage(starts[i]).catch(() => [] as RawCoin[]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, starts.length) }, worker),
  );

  const ids: Record<string, number> = {};
  for (const page of pages) {
    for (const c of page ?? []) {
      const sym = (c.symbol ?? '').toUpperCase();
      if (!sym || !Number.isFinite(c.id)) continue;
      // Pages arrive market-cap desc, so the first id wins a ticker collision — i.e. the most
      // valuable claimant of a duplicated ticker keeps the logo.
      if (!(sym in ids)) ids[sym] = c.id;
    }
  }

  const payload: CoinLogoPayload = {
    base: 'https://s2.coinmarketcap.com/static/img/coins/64x64/',
    ext: '.png',
    ids,
    updatedAt: Date.now(),
  };

  // Never cache a wipeout — a transient upstream blip would otherwise strip every icon for the
  // full TTL. Keep serving the previous good map instead.
  if (Object.keys(ids).length > 0) cache = { at: Date.now(), payload };
  else if (cache) return cache.payload;

  return payload;
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }
  if (!inflight) {
    inflight = build().finally(() => {
      inflight = null;
    });
  }
  const payload = await inflight;
  // Let the browser and CDN hold it too — this map is identical for every visitor.
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400' },
  });
}
