import { NextResponse } from 'next/server';

// TEMPORARY probe: which Bybit host is reachable from Vercel's IPs. Reports status only. DELETE.
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
    let listLen = -1;
    try {
      listLen = (JSON.parse(t)?.result?.list ?? []).length;
    } catch {
      /* not json */
    }
    return { url, status: res.status, ok: res.ok, listLen, bodyHead: t.slice(0, 100) };
  } catch (e) {
    return { url, error: String((e as Error)?.message ?? e) };
  }
}

export async function GET() {
  const hosts = [
    'https://api.bybit.com/v5/market/tickers?category=spot',
    'https://api.bytick.com/v5/market/tickers?category=spot',
    'https://api.bybit.nl/v5/market/tickers?category=spot',
  ];
  const results = [];
  for (const h of hosts) results.push(await probe(h));
  return NextResponse.json({ results });
}
