// Allow-list validation + upstream fetch for the market proxy route.
//
// Lives outside route.ts so the logic tests can import it under plain `node`
// (route.ts imports `next/server`, which doesn't resolve outside a Next build —
// same split as api/market/screener's stocks.ts). `fetchFn` is injectable for
// the same reason.

export const ALLOWED_HOSTS = new Set([
  'api.kucoin.com',
  'api.mexc.com',
  'api.gateio.ws',
  'api.kraken.com',
  'www.okx.com',
  'api.coingecko.com', // asset-name map for search-by-name
  'query1.finance.yahoo.com', // chart/search API — CORS-blocked in the browser
]);

export const UPSTREAM_TIMEOUT_MS = 20_000;

/** Parse + allow-list check; null = refuse (bad URL, non-https, or unknown host). */
export function validateTarget(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return null;
  return u;
}

export interface UpstreamResult {
  status: number;
  body: string;
  contentType: string;
}

// Redirects are followed by hand (`redirect: 'manual'`) so every hop is re-checked
// against the allow-list — the default 'follow' would let a compromised upstream
// 302 this server into internal addresses (SSRF). Real exchange APIs redirect
// rarely, so a small hop budget is plenty.
const MAX_REDIRECTS = 3;

/** Fetch an already-validated target. null = refused (see route for the 502 mapping). */
export async function fetchAllowed(
  target: URL,
  fetchFn: typeof fetch = fetch,
): Promise<UpstreamResult | null> {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchFn(current.toString(), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      let next: URL | null = null;
      try {
        next = loc ? validateTarget(new URL(loc, current).toString()) : null;
      } catch {
        next = null;
      }
      if (!next || hop === MAX_REDIRECTS) return null;
      current = next;
      continue;
    }
    const body = await res.text();
    const upstreamType = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body,
      // Never trust the upstream's type into our own origin — a non-JSON body
      // (e.g. an HTML error/attack page) must not render as HTML same-origin.
      contentType: /json/i.test(upstreamType) ? upstreamType : 'application/json',
    };
  }
  return null;
}
