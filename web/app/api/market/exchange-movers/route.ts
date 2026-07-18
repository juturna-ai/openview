import { NextResponse } from 'next/server';

// Per-exchange movers for the Gainers & Losers board: what's actually pumping/dumping on a given
// venue, as opposed to the CMC-wide view. One request per venue, both keyless:
//
//   Coinbase   GET api.exchange.coinbase.com/products/stats — every product's 24h open/last/volume
//              in one map. No percent field, so Δ = (last − open) / open. Volume is in base units;
//              × last ≈ quote (dollar) volume, valid because only dollar-quoted pairs are kept.
//
//   Bybit      GET api.bybit.com/v5/market/tickers?category=spot — `price24hPcnt` is a fraction
//              ("0.0035"), `turnover24h` is already quote volume.
//
// Both are filtered to dollar quotes (USD/USDT/USDC) so "volume" means dollars everywhere, then
// deduped by base asset keeping the deepest pair — BTC-USD and BTC-USDT are one row, not two.
// Bybit's leveraged tokens (…3L/…3S etc.) are dropped: they're products, not assets, and their
// engineered ±3× moves would otherwise own the top of every list.
//
// Same posture as ../screener: undocumented-ish public upstreams, so every failure is soft (empty
// rows, never a throw) and responses are cached so the client's 30s poll doesn't hammer anyone.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

// api.bybit.com geo-blocks US datacenter IPs (Vercel's default region), returning nothing — which
// left the Bybit tab permanently empty in production. api.bytick.com is Bybit's official mirror with
// the identical /v5/* API, reachable from those IPs.
const BYBIT_HOST = 'https://api.bytick.com';

/** One normalised ticker row. `volume` is 24h quote volume in dollars. */
export interface ExchangeRow {
  symbol: string;
  pair: string;
  price: number | null;
  change24h: number | null;
  volume: number | null;
}

const QUOTES = ['USD', 'USDT', 'USDC'] as const;

/** Bybit lists leveraged tokens as spot pairs; their bases end in a leverage suffix. */
const LEVERAGED_RE = /[2-5][LS]$/;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Split "BTCUSDT"/"BTC-USD" into base + quote, or null if the quote isn't a dollar. */
function splitPair(pair: string): { base: string; quote: string } | null {
  const compact = pair.replace('-', '');
  for (const q of QUOTES) {
    if (compact.endsWith(q) && compact.length > q.length) {
      return { base: compact.slice(0, -q.length), quote: q };
    }
  }
  return null;
}

/** Keep one row per base asset — the one with the most volume behind it. */
function dedupeByBase(rows: (ExchangeRow & { base: string })[]): ExchangeRow[] {
  const best = new Map<string, ExchangeRow & { base: string }>();
  for (const r of rows) {
    const prev = best.get(r.base);
    if (!prev || (r.volume ?? 0) > (prev.volume ?? 0)) best.set(r.base, r);
  }
  return [...best.values()].map(({ base: _base, ...row }) => row);
}

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'openview-web' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchCoinbase(): Promise<ExchangeRow[]> {
  const data = (await fetchJSON('https://api.exchange.coinbase.com/products/stats')) as Record<
    string,
    { stats_24hour?: { open?: string; last?: string; volume?: string } }
  >;
  const rows: (ExchangeRow & { base: string })[] = [];
  for (const [pair, stats] of Object.entries(data ?? {})) {
    const split = splitPair(pair);
    if (!split) continue;
    const s = stats?.stats_24hour ?? {};
    const open = num(s.open);
    const last = num(s.last);
    const baseVol = num(s.volume);
    if (last == null || last <= 0) continue;
    rows.push({
      base: split.base,
      symbol: split.base,
      pair,
      price: last,
      change24h: open != null && open > 0 ? ((last - open) / open) * 100 : null,
      volume: baseVol != null ? baseVol * last : null,
    });
  }
  return dedupeByBase(rows);
}

async function fetchBybit(): Promise<ExchangeRow[]> {
  const data = (await fetchJSON(`${BYBIT_HOST}/v5/market/tickers?category=spot`)) as {
    result?: {
      list?: { symbol?: string; lastPrice?: string; price24hPcnt?: string; turnover24h?: string }[];
    };
  };
  const rows: (ExchangeRow & { base: string })[] = [];
  for (const t of data?.result?.list ?? []) {
    const split = splitPair(t.symbol ?? '');
    if (!split || LEVERAGED_RE.test(split.base)) continue;
    const last = num(t.lastPrice);
    const pcnt = num(t.price24hPcnt);
    if (last == null || last <= 0) continue;
    rows.push({
      base: split.base,
      symbol: split.base,
      pair: t.symbol ?? '',
      price: last,
      change24h: pcnt != null ? pcnt * 100 : null,
      volume: num(t.turnover24h),
    });
  }
  return dedupeByBase(rows);
}

const VENUES = { coinbase: fetchCoinbase, bybit: fetchBybit } as const;
type Venue = keyof typeof VENUES;

const cache = new Map<Venue, { at: number; rows: ExchangeRow[] }>();

export async function GET(req: Request) {
  const venue = new URL(req.url).searchParams.get('venue') as Venue | null;
  if (!venue || !(venue in VENUES)) {
    return NextResponse.json({ error: 'Unknown venue' }, { status: 400 });
  }

  const hit = cache.get(venue);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ venue, rows: hit.rows });
  }

  try {
    const rows = await VENUES[venue]();
    // An upstream hiccup that parses to zero rows shouldn't evict a good cache entry.
    if (rows.length > 0) cache.set(venue, { at: Date.now(), rows });
    return NextResponse.json({ venue, rows: rows.length > 0 ? rows : (hit?.rows ?? []) });
  } catch {
    // Serve stale over serving nothing; an empty list only when there's truly nothing to show.
    return NextResponse.json({ venue, rows: hit?.rows ?? [] });
  }
}
