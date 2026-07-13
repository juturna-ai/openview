import { NextResponse } from 'next/server';

// Gainers & losers for metals + currencies.
//
// Reach's own Gainers & Losers page is crypto-only (CoinMarketCap's listing endpoint), and the
// metals/FX sources it uses elsewhere return a spot price with no 24h reference — Reach hardcodes
// `change24h: 0` for both. A gainers/losers ranking needs a real change, so this route sources one:
// Yahoo's metal futures carry a previous close, and Frankfurter serves historical dates that can be
// diffed against the latest. Both are keyless.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

const METALS: { symbol: string; name: string; ticker: string }[] = [
  { symbol: 'XAU', name: 'Gold', ticker: 'GC=F' },
  { symbol: 'XAG', name: 'Silver', ticker: 'SI=F' },
  { symbol: 'XPT', name: 'Platinum', ticker: 'PL=F' },
  { symbol: 'XPD', name: 'Palladium', ticker: 'PA=F' },
];

// Stocks + ETFs. Yahoo's chart endpoint (already used for the metals futures above) serves equities
// with the same shape — regularMarketPrice + chartPreviousClose + regularMarketVolume — so this
// needs no second provider and no API key.
const STOCKS: { symbol: string; name: string }[] = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'AMD', name: 'AMD' },
  { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'COIN', name: 'Coinbase' },
  { symbol: 'MSTR', name: 'MicroStrategy' },
  { symbol: 'JPM', name: 'JPMorgan Chase' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ ETF' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
];

const CURRENCIES: { symbol: string; name: string }[] = [
  { symbol: 'EUR', name: 'Euro' },
  { symbol: 'GBP', name: 'British Pound' },
  { symbol: 'JPY', name: 'Japanese Yen' },
  { symbol: 'MXN', name: 'Mexican Peso' },
  { symbol: 'CAD', name: 'Canadian Dollar' },
  { symbol: 'AUD', name: 'Australian Dollar' },
  { symbol: 'CHF', name: 'Swiss Franc' },
  { symbol: 'CNY', name: 'Chinese Yuan' },
  { symbol: 'BRL', name: 'Brazilian Real' },
  { symbol: 'KRW', name: 'Korean Won' },
];

export interface MoverRow {
  symbol: string;
  name: string;
  assetType: 'metal' | 'currency' | 'stock';
  price: number;
  change24h: number;
  /** Metals + stocks report volume; FX spot has no meaningful equivalent. */
  volume: number | null;
}

/** One Yahoo chart quote → a row. Shared by metals (futures) and stocks/ETFs (equities). */
async function yahooRow(
  ticker: string,
  symbol: string,
  name: string,
  assetType: 'metal' | 'stock',
): Promise<MoverRow | null> {
  const d = (await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
  )) as { chart?: { result?: { meta?: Record<string, number> }[] } };
  const meta = d?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number') return null;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose;
  return {
    symbol,
    name,
    assetType,
    price,
    change24h: typeof prev === 'number' && prev !== 0 ? ((price - prev) / prev) * 100 : 0,
    volume: typeof meta?.regularMarketVolume === 'number' ? meta.regularMarketVolume : null,
  };
}

/** Settle a batch of yahooRow promises, dropping the ones that failed or returned no price. */
async function settleRows(jobs: Promise<MoverRow | null>[]): Promise<MoverRow[]> {
  const results = await Promise.allSettled(jobs);
  return results
    .filter((r): r is PromiseFulfilledResult<MoverRow | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is MoverRow => r !== null);
}

async function metalRows(): Promise<MoverRow[]> {
  return settleRows(METALS.map((m) => yahooRow(m.ticker, m.symbol, m.name, 'metal')));
}

async function stockRows(): Promise<MoverRow[]> {
  return settleRows(STOCKS.map((s) => yahooRow(s.symbol, s.symbol, s.name, 'stock')));
}

async function currencyRows(): Promise<MoverRow[]> {
  const latest = (await fetchJSON('https://api.frankfurter.dev/v1/latest?base=USD')) as {
    date?: string;
    rates?: Record<string, number>;
  };
  const rates = latest?.rates ?? {};

  // Step back from the latest *published* date, not from today — Frankfurter skips weekends and
  // holidays, so "yesterday" is often not a trading session.
  let prevRates: Record<string, number> = {};
  if (latest?.date) {
    const d = new Date(latest.date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    try {
      const prev = (await fetchJSON(
        `https://api.frankfurter.dev/v1/${d.toISOString().slice(0, 10)}?base=USD`,
      )) as { rates?: Record<string, number> };
      prevRates = prev?.rates ?? {};
    } catch {
      // No prior session — rows still render, just with a 0 change.
    }
  }

  const rows: MoverRow[] = [];
  for (const c of CURRENCIES) {
    const rate = rates[c.symbol];
    if (!rate) continue;
    // Rates are quoted per 1 USD; invert for the USD value of one unit.
    const price = 1 / rate;
    const prevRate = prevRates[c.symbol];
    const prevPrice = prevRate ? 1 / prevRate : 0;
    rows.push({
      symbol: c.symbol,
      name: c.name,
      assetType: 'currency',
      price,
      change24h: prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0,
      volume: null,
    });
  }
  return rows;
}

// Only ~14 symbols and the client auto-refreshes, so cache a little longer than the price route.
const CACHE_TTL_MS = 60_000;
let cached: { at: number; rows: MoverRow[] } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ rows: cached.rows, updatedAt: cached.at });
  }

  const [metals, currencies, stocks] = await Promise.all([
    metalRows().catch(() => [] as MoverRow[]),
    currencyRows().catch(() => [] as MoverRow[]),
    stockRows().catch(() => [] as MoverRow[]),
  ]);
  const rows = [...metals, ...currencies, ...stocks];

  // Don't cache a total wipeout — a transient upstream failure would otherwise stick for a minute.
  if (rows.length > 0) cached = { at: Date.now(), rows };

  return NextResponse.json({ rows, updatedAt: Date.now() });
}
