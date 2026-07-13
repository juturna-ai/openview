import { NextResponse } from 'next/server';

// Server-side price proxy for the wallet. Reach does this inside its Electron main process
// (`wallet:getPrices` in electron/main.js); in a web app the same calls have to live behind an API
// route — the browser can't reach these hosts (CORS) and CLAUDE.md forbids calling external APIs
// from client code regardless.
//
// All four upstreams are keyless. One divergence from Reach: it prices metals via Swissquote, which
// returns a spot price with no 24h reference, so Reach hardcodes `change24h: 0`. We use Yahoo's
// futures tickers instead, which carry a previous close — a real 24h change.

export const runtime = 'nodejs';
// Prices are polled; never let a CDN pin a stale quote.
export const dynamic = 'force-dynamic';

interface Quote {
  price: number;
  change24h: number;
}

/** Yahoo futures contracts standing in for metal spot symbols. */
const METAL_TICKERS: Record<string, string> = {
  XAU: 'GC=F',
  XAG: 'SI=F',
  XPT: 'PL=F',
  XPD: 'PA=F',
};

// Yahoo 403s a default fetch agent.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 8000;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Pulls price + 24h change out of a Yahoo chart payload (used for both stocks and metals). */
async function yahooQuote(ticker: string): Promise<Quote | null> {
  const d = (await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
  )) as { chart?: { result?: { meta?: Record<string, number> }[] } };
  const meta = d?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  if (typeof price !== 'number') return null;
  return {
    price,
    change24h: typeof prev === 'number' && prev !== 0 ? ((price - prev) / prev) * 100 : 0,
  };
}

async function binanceQuote(symbol: string): Promise<Quote | null> {
  const d = (await fetchJSON(
    `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}USDT`,
  )) as { lastPrice?: string; priceChangePercent?: string };
  const price = parseFloat(d?.lastPrice ?? '');
  if (!Number.isFinite(price)) return null;
  const change = parseFloat(d?.priceChangePercent ?? '');
  return { price, change24h: Number.isFinite(change) ? change : 0 };
}

/**
 * Frankfurter quotes currencies per 1 USD, so the USD value of one unit is the reciprocal. Reach
 * stops at the latest rate (change24h: 0); we also pull the previous session and diff the two.
 */
async function currencyQuotes(symbols: string[]): Promise<Record<string, Quote | null>> {
  const out: Record<string, Quote | null> = {};
  const latest = (await fetchJSON('https://api.frankfurter.dev/v1/latest?base=USD')) as {
    date?: string;
    rates?: Record<string, number>;
  };
  const rates = latest?.rates ?? {};

  // Frankfurter only publishes on business days; walk back from the latest *published* date rather
  // than from today, or a Monday request would diff against a weekend that has no data.
  let prevRates: Record<string, number> = {};
  if (latest?.date) {
    const d = new Date(latest.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const prior = d.toISOString().slice(0, 10);
    try {
      const prev = (await fetchJSON(`https://api.frankfurter.dev/v1/${prior}?base=USD`)) as {
        rates?: Record<string, number>;
      };
      prevRates = prev?.rates ?? {};
    } catch {
      // Fall through — a missing prior session just means no change figure, not a failed quote.
    }
  }

  for (const sym of symbols) {
    const rate = rates[sym];
    if (!rate) {
      out[sym] = null;
      continue;
    }
    const price = 1 / rate;
    const prevRate = prevRates[sym];
    const prevPrice = prevRate ? 1 / prevRate : 0;
    out[sym] = {
      price,
      change24h: prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0,
    };
  }
  return out;
}

type AssetType = 'crypto' | 'stock' | 'metal' | 'currency';
interface HoldingRef {
  symbol: string;
  asset_type: AssetType;
}

// Cache upstream responses briefly. The client polls every 30s and several tabs may poll at once;
// without this, each poll fans out to Binance/Yahoo per symbol and invites a rate-limit.
const CACHE_TTL_MS = 20_000;
const cache = new Map<string, { at: number; quote: Quote | null }>();

export async function POST(req: Request) {
  let holdings: HoldingRef[];
  try {
    const body: unknown = await req.json();
    if (!Array.isArray(body)) throw new Error('expected an array');
    holdings = body
      .filter((h): h is HoldingRef => !!h && typeof h === 'object')
      .map((h) => ({ symbol: String(h.symbol ?? '').toUpperCase(), asset_type: h.asset_type }))
      .filter(
        (h) =>
          // Anything from the browser is untrusted; only let known-shaped symbols reach an upstream URL.
          /^[A-Z0-9]{1,10}$/.test(h.symbol) &&
          ['crypto', 'stock', 'metal', 'currency'].includes(h.asset_type),
      );
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const prices: Record<string, Quote | null> = {};
  const now = Date.now();

  // Serve what's still fresh, and only go upstream for the rest.
  const stale = holdings.filter((h) => {
    const hit = cache.get(`${h.asset_type}:${h.symbol}`);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      prices[h.symbol] = hit.quote;
      return false;
    }
    return true;
  });

  const jobs: Promise<void>[] = [];

  const put = (h: HoldingRef, q: Quote | null) => {
    prices[h.symbol] = q;
    cache.set(`${h.asset_type}:${h.symbol}`, { at: Date.now(), quote: q });
  };

  for (const h of stale) {
    if (h.asset_type === 'crypto') {
      jobs.push(
        binanceQuote(h.symbol)
          .then((q) => put(h, q))
          .catch(() => put(h, null)),
      );
    } else if (h.asset_type === 'stock') {
      jobs.push(
        yahooQuote(h.symbol)
          .then((q) => put(h, q))
          .catch(() => put(h, null)),
      );
    } else if (h.asset_type === 'metal') {
      const ticker = METAL_TICKERS[h.symbol];
      if (!ticker) {
        put(h, null);
        continue;
      }
      jobs.push(
        yahooQuote(ticker)
          .then((q) => put(h, q))
          .catch(() => put(h, null)),
      );
    }
  }

  // Currencies come from a single call covering every symbol, so they're batched rather than per-symbol.
  const staleCurrencies = stale.filter((h) => h.asset_type === 'currency');
  if (staleCurrencies.length > 0) {
    jobs.push(
      currencyQuotes(staleCurrencies.map((h) => h.symbol))
        .then((quotes) => {
          for (const h of staleCurrencies) put(h, quotes[h.symbol] ?? null);
        })
        .catch(() => {
          for (const h of staleCurrencies) put(h, null);
        }),
    );
  }

  await Promise.allSettled(jobs);

  return NextResponse.json(prices);
}
