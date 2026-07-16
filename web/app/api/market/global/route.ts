import { NextResponse } from 'next/server';

// Global market snapshot — powers the three cards on the Home hero (Market Cap, Fear & Greed,
// Altcoin Season).
//
// Same keyless CMC data-api/v3 approach as ../cmc/route.ts (undocumented endpoints the CMC
// frontend itself calls; they require a browser User-Agent and send no CORS, so this must be
// server-side). Fear & Greed comes from alternative.me, matching the cmc route.
//
// Every source fails soft (null, never a throw) and the payload is cached so the client's poll
// doesn't hammer upstream.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/* ── Total market cap (+ 24h % change) ── */

async function fetchMarketCap(): Promise<{ marketCap: number | null; change24h: number | null }> {
  const d = (await fetchJSON(
    'https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/latest',
  )) as { data?: { quotes?: { totalMarketCap?: number; totalMarketCapYesterdayPercentageChange?: number }[] } };
  const q = d?.data?.quotes?.[0] ?? {};
  return {
    marketCap: num(q.totalMarketCap),
    change24h: num(q.totalMarketCapYesterdayPercentageChange),
  };
}

/* ── Total market cap sparkline (last 24h) ── */

export interface SeriesPoint {
  /** Unix ms — for the hover tooltip's date/time. */
  t: number;
  /** Total market cap in USD. */
  v: number;
}

async function fetchMarketCapSeries(): Promise<SeriesPoint[]> {
  // 4-year daily series for the sparkline's hover-scrub. `range` caps at ~400 points (~13 months),
  // so we pass an explicit `timeStart`/`timeEnd` window (unix seconds) with `interval=1d` instead —
  // that returns the full ~1460 daily points. `interval` is also what unlocks this endpoint (it
  // 500s without one). convertId 2781 = USD. The ▼/▲ badge stays the 24h change from the *latest*
  // endpoint; only this series is long-range.
  const end = Math.floor(Date.now() / 1000);
  const start = end - 4 * 365 * 86_400;
  const d = (await fetchJSON(
    `https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical?convertId=2781&interval=1d&timeStart=${start}&timeEnd=${end}`,
  )) as { data?: { quotes?: { timestamp?: string; quote?: { totalMarketCap?: number }[] }[] } };
  return (d?.data?.quotes ?? [])
    .map((row) => {
      const v = num(row.quote?.[0]?.totalMarketCap);
      const t = row.timestamp ? Date.parse(row.timestamp) : NaN;
      return v != null && Number.isFinite(t) ? { t, v } : null;
    })
    .filter((p): p is SeriesPoint => p != null);
}

/* ── Altcoin Season index (0–100; higher = altcoin season) ── */

async function fetchAltcoinSeason(): Promise<number | null> {
  // The chart endpoint requires start/end timestamps but returns the current index under
  // `historicalValues.now` regardless of the window — a recent 2-day range is enough.
  const end = Math.floor(Date.now() / 1000);
  const start = end - 2 * 86_400;
  const d = (await fetchJSON(
    `https://api.coinmarketcap.com/data-api/v3/altcoin-season/chart?start=${start}&end=${end}`,
  )) as { data?: { historicalValues?: { now?: { altcoinIndex?: string } } } };
  return num(d?.data?.historicalValues?.now?.altcoinIndex);
}

/* ── Fear & Greed (alternative.me, keyless) ── */

async function fetchFearGreed(): Promise<{ value: number; classification: string } | null> {
  const d = (await fetchJSON('https://api.alternative.me/fng/?limit=1')) as {
    data?: { value?: string; value_classification?: string }[];
  };
  const row = d?.data?.[0];
  const value = row?.value != null ? parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(value)) return null;
  return { value, classification: row?.value_classification ?? '' };
}

/* ── Handler ── */

export interface GlobalPayload {
  marketCap: number | null;
  marketCapChange24h: number | null;
  marketCapSeries: SeriesPoint[];
  fearGreed: { value: number; classification: string } | null;
  altcoinSeason: number | null;
  updatedAt: number;
}

let cache: { at: number; payload: GlobalPayload } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  // Each source fails independently — one dead endpoint must not blank the whole row.
  const [mc, mcSeries, fearGreed, altcoinSeason] = await Promise.all([
    fetchMarketCap().catch(() => ({ marketCap: null, change24h: null })),
    fetchMarketCapSeries().catch(() => [] as SeriesPoint[]),
    fetchFearGreed().catch(() => null),
    fetchAltcoinSeason().catch(() => null),
  ]);

  const payload: GlobalPayload = {
    marketCap: mc.marketCap,
    marketCapChange24h: mc.change24h,
    marketCapSeries: mcSeries,
    fearGreed,
    altcoinSeason,
    updatedAt: Date.now(),
  };

  // Don't cache a total wipeout — a transient upstream blip would otherwise stick for the full TTL.
  if (mc.marketCap != null || fearGreed != null || altcoinSeason != null) {
    cache = { at: Date.now(), payload };
  }

  return NextResponse.json(payload);
}
