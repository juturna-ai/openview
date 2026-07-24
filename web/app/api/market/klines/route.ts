import { NextResponse } from 'next/server';

// Historical price series for the wallet charts. Same reasoning as the prices route: the browser
// can't reach Binance/Yahoo (CORS) and CLAUDE.md forbids calling external APIs from client code,
// so the klines calls live here. Keyless, like every other wallet upstream.
//
// GET  — single-symbol BTC/ETH trend line for the "All-time profit" chart (original endpoint).
// POST — per-holding history for the portfolio History chart: crypto via Binance, stock/metal via
//        Yahoo, currency via Frankfurter (daily). The client sums amount × close per timestamp to
//        draw real 24h/7d/... movement instead of only locally recorded snapshots.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UPSTREAM_TIMEOUT_MS = 8000;

// The chart offers 24h/7d/30d/90d/All. Each maps to a Binance interval + count that yields ~100–200
// points — enough for a smooth line without pulling thousands of candles.
const RANGES: Record<string, { interval: string; limit: number }> = {
  '24h': { interval: '15m', limit: 96 },
  '7d': { interval: '1h', limit: 168 },
  '30d': { interval: '4h', limit: 180 },
  '90d': { interval: '12h', limit: 180 },
  all: { interval: '1d', limit: 365 },
};

// Only symbols the wallet actually charts a trend for. Kept to a short allow-list so an arbitrary
// value can't be interpolated into the upstream URL.
const ALLOWED = new Set(['BTC', 'ETH']);

interface Point {
  t: number;
  close: number;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') ?? 'BTC').toUpperCase();
  const rangeKey = (url.searchParams.get('range') ?? '7d').toLowerCase();

  if (!ALLOWED.has(symbol)) {
    return NextResponse.json({ error: 'Unsupported symbol' }, { status: 400 });
  }
  const range = RANGES[rangeKey] ?? RANGES['7d'];

  try {
    // data-api.binance.vision, not api.binance.com: the latter 451s from US datacenter IPs (Vercel).
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}USDT&interval=${range.interval}&limit=${range.limit}`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    if (!res.ok) return NextResponse.json({ points: [] as Point[] });
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return NextResponse.json({ points: [] as Point[] });

    // Each candle is [openTime, open, high, low, close, ...]; we only need openTime + close.
    const points: Point[] = raw
      .map((c) => {
        const row = c as unknown[];
        const t = typeof row[0] === 'number' ? row[0] : NaN;
        const close = parseFloat(String(row[4] ?? ''));
        return { t, close };
      })
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.close) && p.close > 0);

    return NextResponse.json({ points });
  } catch {
    // A transient upstream failure just means no trend line this poll, not a broken chart.
    return NextResponse.json({ points: [] as Point[] });
  }
}

// ── Multi-asset history (POST) ──

type AssetType = 'crypto' | 'stock' | 'metal' | 'currency';

/** Yahoo futures contracts standing in for metal spot symbols (same map as the prices route). */
const METAL_TICKERS: Record<string, string> = {
  XAU: 'GC=F',
  XAG: 'SI=F',
  XPT: 'PL=F',
  XPD: 'PA=F',
};

// Yahoo's chart API takes (interval, range) pairs rather than a candle count.
const YAHOO_RANGES: Record<string, { interval: string; range: string }> = {
  '24h': { interval: '5m', range: '1d' },
  '7d': { interval: '60m', range: '5d' },
  '30d': { interval: '1d', range: '1mo' },
  '90d': { interval: '1d', range: '3mo' },
  all: { interval: '1d', range: '1y' },
};

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function binanceSeries(symbol: string, rangeKey: string): Promise<Point[]> {
  const range = RANGES[rangeKey] ?? RANGES['7d'];
  const raw = (await fetchJSON(
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}USDT&interval=${range.interval}&limit=${range.limit}`,
  )) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const row = c as unknown[];
      const t = typeof row[0] === 'number' ? row[0] : NaN;
      const close = parseFloat(String(row[4] ?? ''));
      return { t, close };
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.close) && p.close > 0);
}

async function yahooSeries(ticker: string, rangeKey: string): Promise<Point[]> {
  const r = YAHOO_RANGES[rangeKey] ?? YAHOO_RANGES['7d'];
  const d = (await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${r.interval}&range=${r.range}`,
  )) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const result = d?.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points: Point[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = closes[i];
    if (typeof ts[i] === 'number' && typeof close === 'number' && close > 0) {
      points.push({ t: ts[i] * 1000, close });
    }
  }
  return points;
}

/** Frankfurter publishes daily rates only — coarse, but a currency line barely moves intraday. */
async function currencySeries(symbol: string, rangeKey: string): Promise<Point[]> {
  const hours: Record<string, number> = { '24h': 48, '7d': 168, '30d': 720, '90d': 2160, all: 8760 };
  const start = new Date(Date.now() - (hours[rangeKey] ?? 168) * 3600_000).toISOString().slice(0, 10);
  const d = (await fetchJSON(
    `https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${encodeURIComponent(symbol)}`,
  )) as { rates?: Record<string, Record<string, number>> };
  const rates = d?.rates ?? {};
  return Object.keys(rates)
    .sort()
    .map((day) => {
      const rate = rates[day]?.[symbol];
      return { t: Date.parse(`${day}T00:00:00Z`), close: rate ? 1 / rate : NaN };
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.close) && p.close > 0);
}

// History barely changes between polls; a 5-min cache keeps a multi-holding portfolio from fanning
// out to three upstreams on every period switch.
const SERIES_TTL_MS = 5 * 60_000;
const seriesCache = new Map<string, { at: number; points: Point[] }>();

interface AssetRef {
  symbol: string;
  asset_type: AssetType;
}

export async function POST(req: Request) {
  let rangeKey = '7d';
  let assets: AssetRef[];
  try {
    const body = (await req.json()) as { range?: unknown; assets?: unknown };
    rangeKey = typeof body.range === 'string' && body.range.toLowerCase() in RANGES ? body.range.toLowerCase() : '7d';
    if (!Array.isArray(body.assets)) throw new Error('expected assets array');
    assets = body.assets
      .filter((a): a is AssetRef => !!a && typeof a === 'object')
      .map((a) => ({ symbol: String(a.symbol ?? '').toUpperCase(), asset_type: a.asset_type }))
      // Untrusted input: only known-shaped symbols may reach an upstream URL, and cap the fan-out.
      .filter(
        (a) =>
          /^[A-Z0-9]{1,10}$/.test(a.symbol) &&
          ['crypto', 'stock', 'metal', 'currency'].includes(a.asset_type),
      )
      .slice(0, 30);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const series: Record<string, Point[]> = {};
  const now = Date.now();

  const jobs = assets.map(async (a) => {
    const key = `${a.asset_type}:${a.symbol}:${rangeKey}`;
    const hit = seriesCache.get(key);
    if (hit && now - hit.at < SERIES_TTL_MS) {
      series[a.symbol] = hit.points;
      return;
    }
    let points: Point[] = [];
    try {
      if (a.asset_type === 'crypto') points = await binanceSeries(a.symbol, rangeKey);
      else if (a.asset_type === 'stock') points = await yahooSeries(a.symbol, rangeKey);
      else if (a.asset_type === 'metal') {
        const ticker = METAL_TICKERS[a.symbol];
        if (ticker) points = await yahooSeries(ticker, rangeKey);
      } else if (a.asset_type === 'currency') points = await currencySeries(a.symbol, rangeKey);
    } catch {
      // A failed upstream just means this holding contributes a flat line, not a broken chart.
    }
    series[a.symbol] = points;
    // Only cache real data — an empty result from a transient failure shouldn't stick for 5 min.
    if (points.length > 0) seriesCache.set(key, { at: Date.now(), points });
  });

  await Promise.allSettled(jobs);
  return NextResponse.json({ series });
}
