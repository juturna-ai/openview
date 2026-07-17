import { NextResponse } from 'next/server';
import { validateTarget, fetchAllowed } from './upstream';

// Same-origin proxy for the chart engine's CORS-blocked exchange APIs.
//
// KuCoin, MEXC and Gate.io serve keyless public market data but send no CORS
// headers, so the browser can't read them directly. The engine used to fall back
// to public CORS proxies — slow, rate-limited, and unable to carry the MB-scale
// catalog payloads. This route does the fetch server-side instead.
//
// NOT an open proxy: only GET, only to an exact allow-list of exchange API hosts,
// nothing forwarded from the caller but the URL. Anything else is a 400.
// Allow-list + fetch logic lives in upstream.ts so it's testable under plain node.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url') ?? '';
  const u = validateTarget(target);
  if (!u) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 });
  }
  try {
    const r = await fetchAllowed(u);
    if (!r) {
      return NextResponse.json({ error: 'upstream unreachable' }, { status: 502 });
    }
    return new NextResponse(r.body, {
      status: r.status,
      headers: {
        'Content-Type': r.contentType,
        // Catalog payloads are static for hours; let the browser reuse them briefly.
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'upstream unreachable' }, { status: 502 });
  }
}
