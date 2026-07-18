import { NextResponse } from 'next/server';

// TEMPORARY: verify Bybit + Binance reachability from the pinned region. Status only. DELETE.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function probe(url: string) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'openview-web' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    const t = await res.text();
    return { url, status: res.status, ok: res.ok, len: t.length };
  } catch (e) {
    return { url, error: String((e as Error)?.message ?? e) };
  }
}

export async function GET() {
  const hosts = [
    'https://api.bybit.com/v5/market/tickers?category=spot',
    'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT',
  ];
  const results = [];
  for (const h of hosts) results.push(await probe(h));
  return NextResponse.json({ region: process.env.VERCEL_REGION ?? 'unknown', results });
}
