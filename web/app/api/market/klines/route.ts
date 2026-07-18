import { NextResponse } from 'next/server';

// Historical price series for the wallet's "All-time profit" chart — the orange "BTC trend" line
// that sits behind the portfolio's profit curve. Same reasoning as the prices route: the browser
// can't reach Binance (CORS) and CLAUDE.md forbids calling external APIs from client code, so the
// klines call lives here. Keyless, like every other wallet upstream.

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
