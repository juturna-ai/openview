import { NextResponse } from 'next/server';
import { cleanName, isCommonEquity } from './stocks';

// Leaderboard universes for the non-crypto asset classes: stocks, ETFs and commodities.
//
// The crypto board gets its 500 ranked coins from a single CoinMarketCap call (see ../cmc). This
// route is the equivalent for everything else: a universe deep enough to page through 100 at a time,
// which is what the old hand-picked symbol lists (4 metals, 12 stocks, 4 ETFs) could never be.
//
// Sources (all keyless — no API key, no signup):
//
//   Stocks      Nasdaq's own screener, the one nasdaq.com calls from the browser. One request
//               returns 500 rows already sorted by market cap descending. It rejects requests
//               without a browser User-Agent, hence the UA header.
//
//   ETFs        No keyless source ranks ETFs by AUM: Nasdaq's ETF screener carries no AUM, market
//               cap or volume field and offers no working sort (it comes back alphabetical), and
//               Yahoo has no ETF screener id. So the universe is the curated list below — AUM
//               rankings barely move week to week — priced individually off Yahoo's chart endpoint,
//               which unlike Nasdaq's screener does report volume.
//
//   Commodities No commodity screener exists on either provider, so these are likewise fetched
//               per-symbol from Yahoo. There are only ~15 of them, so that's cheap.
//
// Both upstreams are undocumented and can change without notice — Yahoo already locked down its
// v7/finance/quote endpoint behind a "crumb". Every source therefore fails soft (an empty list,
// never a throw), and the whole payload is cached so the client's 30s poll doesn't hammer them.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

/** Nasdaq caps out well above this; 500 matches the crypto board's depth. */
const STOCK_LIMIT = 500;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  /**
   * The row's size, in dollars, so one column is comparable across all classes:
   *   stocks       market cap (price × shares outstanding), from Nasdaq
   *   ETFs         assets under management (Yahoo `totalAssets`)
   *   commodities  notional value of open interest (a future has no market cap — see fetchNotional)
   * Null when the upstream size lookup fails; the UI renders that as a dash.
   */
  marketCap: number | null;
  /** Null for stocks: Nasdaq's screener carries no volume field. Real for ETFs and commodities. */
  volume: number | null;
}

/* ── Stocks: Nasdaq screener, 500 rows, one request, pre-ranked by market cap ── */

interface RawNasdaqRow {
  symbol?: string;
  name?: string;
  lastsale?: string;
  pctchange?: string;
  marketCap?: string;
}

/** Nasdaq returns everything as a display string: "$210.96", "4.034%", "5,105,232,000,000". */
const parseNum = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function fetchStocks(): Promise<ScreenerRow[]> {
  const res = (await fetchJSON(
    `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${STOCK_LIMIT}&country=united_states`,
  )) as { data?: { table?: { rows?: RawNasdaqRow[] } } };

  const seen = new Set<string>();

  return (
    (res?.data?.table?.rows ?? [])
      // Preferred shares, notes and warrants are stamped with the *issuer's* market cap, so they'd
      // rank as a second copy of the company (GOOGM/GOOGN at Alphabet's ~$600B, TBB at AT&T's).
      // See stocks.ts.
      .filter((r) => isCommonEquity(r.name ?? ''))
      .map((r) => ({
        symbol: r.symbol ?? '',
        name: cleanName(r.name ?? '', r.symbol ?? ''),
        price: parseNum(r.lastsale),
        change24h: parseNum(r.pctchange),
        marketCap: parseNum(r.marketCap),
        volume: null, // Not in Nasdaq's payload — the UI renders this as a dash.
      }))
      .filter((r) => r.symbol && r.price != null)
      // Belt-and-braces: Nasdaq has never repeated a symbol in one response, but a duplicate key
      // would render as a genuine duplicate row and only warn in React.
      .filter((r) => {
        if (seen.has(r.symbol)) return false;
        seen.add(r.symbol);
        return true;
      })
  );
}

/* ── ETFs + commodities: Yahoo's chart endpoint, one request per symbol ── */

/** Top ETFs by AUM. A slow-moving ranking, so a static list stays accurate for a long time. */
const ETFS: { symbol: string; name: string }[] = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF' },
  { symbol: 'IVV', name: 'iShares Core S&P 500 ETF' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'VUG', name: 'Vanguard Growth ETF' },
  { symbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF' },
  { symbol: 'IEFA', name: 'iShares Core MSCI EAFE ETF' },
  { symbol: 'VTV', name: 'Vanguard Value ETF' },
  { symbol: 'BND', name: 'Vanguard Total Bond Market ETF' },
  { symbol: 'AGG', name: 'iShares Core U.S. Aggregate Bond ETF' },
  { symbol: 'IWF', name: 'iShares Russell 1000 Growth ETF' },
  { symbol: 'IJH', name: 'iShares Core S&P Mid-Cap ETF' },
  { symbol: 'VIG', name: 'Vanguard Dividend Appreciation ETF' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'VXUS', name: 'Vanguard Total International Stock ETF' },
  { symbol: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF' },
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
  { symbol: 'IAU', name: 'iShares Gold Trust' },
  { symbol: 'SLV', name: 'iShares Silver Trust' },
  { symbol: 'IEMG', name: 'iShares Core MSCI Emerging Markets ETF' },
  { symbol: 'IWD', name: 'iShares Russell 1000 Value ETF' },
  { symbol: 'SCHD', name: 'Schwab US Dividend Equity ETF' },
  { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF' },
  { symbol: 'RSP', name: 'Invesco S&P 500 Equal Weight ETF' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR' },
  { symbol: 'XLV', name: 'Health Care Select Sector SPDR' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF' },
  { symbol: 'HYG', name: 'iShares iBoxx High Yield Corporate Bond ETF' },
  { symbol: 'LQD', name: 'iShares iBoxx Investment Grade Corporate Bond ETF' },
  { symbol: 'EFA', name: 'iShares MSCI EAFE ETF' },
  { symbol: 'EEM', name: 'iShares MSCI Emerging Markets ETF' },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust' },
  { symbol: 'FBTC', name: 'Fidelity Wise Origin Bitcoin Fund' },
  { symbol: 'VYM', name: 'Vanguard High Dividend Yield ETF' },
];

/**
 * Yahoo futures tickers. Names are hardcoded — the contract's own shortName reads "Gold Aug 26",
 * and CT=F (cotton) returns no shortName at all.
 *
 * `size` is the exchange contract size (CME/ICE spec) and `unit` the price basis, both needed to
 * turn open interest into a dollar figure — see notionalValue() below. These are fixed contract
 * specifications, not market data, hence the hardcoding.
 *
 * The subtlety is that Yahoo does not quote every future in the contract's own unit:
 *   - Corn / wheat / soybeans are quoted in **cents** per bushel ("465'25" → 465.25 cents).
 *   - Sugar, coffee, cotton and live cattle are quoted in **cents** per lb.
 *   - Gold, oil, gas etc. are quoted in plain dollars.
 * A cents-quoted contract therefore needs a ÷100 or the notional comes out 100× too big, which is
 * exactly the sort of confidently-wrong number this column must not print. `cents: true` marks them.
 */
const COMMODITIES: {
  ticker: string;
  symbol: string;
  name: string;
  /** Units per contract (100 troy oz of gold, 1,000 barrels of crude, 5,000 bushels of corn…). */
  size: number;
  /** True when Yahoo quotes this contract in cents rather than dollars. */
  cents?: boolean;
}[] = [
  { ticker: 'GC=F', symbol: 'XAU', name: 'Gold', size: 100 },            // 100 troy oz
  { ticker: 'SI=F', symbol: 'XAG', name: 'Silver', size: 5_000 },        // 5,000 troy oz
  { ticker: 'PL=F', symbol: 'XPT', name: 'Platinum', size: 50 },         // 50 troy oz
  { ticker: 'PA=F', symbol: 'XPD', name: 'Palladium', size: 100 },       // 100 troy oz
  { ticker: 'HG=F', symbol: 'HG', name: 'Copper', size: 25_000 },        // 25,000 lb
  { ticker: 'CL=F', symbol: 'CL', name: 'Crude Oil (WTI)', size: 1_000 }, // 1,000 bbl
  { ticker: 'BZ=F', symbol: 'BZ', name: 'Brent Crude Oil', size: 1_000 }, // 1,000 bbl
  { ticker: 'NG=F', symbol: 'NG', name: 'Natural Gas', size: 10_000 },   // 10,000 MMBtu
  { ticker: 'RB=F', symbol: 'RB', name: 'Gasoline (RBOB)', size: 42_000 }, // 42,000 gal
  { ticker: 'ZC=F', symbol: 'ZC', name: 'Corn', size: 5_000, cents: true },     // 5,000 bu, ¢/bu
  { ticker: 'ZW=F', symbol: 'ZW', name: 'Wheat', size: 5_000, cents: true },    // 5,000 bu, ¢/bu
  { ticker: 'ZS=F', symbol: 'ZS', name: 'Soybeans', size: 5_000, cents: true }, // 5,000 bu, ¢/bu
  { ticker: 'SB=F', symbol: 'SB', name: 'Sugar #11', size: 112_000, cents: true }, // 112,000 lb, ¢/lb
  { ticker: 'KC=F', symbol: 'KC', name: 'Coffee', size: 37_500, cents: true },     // 37,500 lb, ¢/lb
  { ticker: 'CT=F', symbol: 'CT', name: 'Cotton', size: 50_000, cents: true },     // 50,000 lb, ¢/lb
  { ticker: 'LE=F', symbol: 'LE', name: 'Live Cattle', size: 40_000, cents: true }, // 40,000 lb, ¢/lb
];

async function yahooRow(ticker: string, symbol: string, name: string): Promise<ScreenerRow | null> {
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
    price,
    change24h: typeof prev === 'number' && prev !== 0 ? ((price - prev) / prev) * 100 : null,
    marketCap: null, // Filled in below for ETFs (AUM) and commodities (notional) — see fetchSize().
    volume: typeof meta?.regularMarketVolume === 'number' ? meta.regularMarketVolume : null,
  };
}

/* ── Size: ETF assets under management, and commodity notional value ────────────────────────────
 *
 * The chart endpoint above carries no size field at all, so the Market Cap column was a dash for
 * both classes. The numbers do exist on Yahoo's `quoteSummary`, but that endpoint is crumb-gated
 * (the same lockdown that killed v7/finance/quote): you must first pull a cookie from fc.yahoo.com,
 * then trade it for a crumb token, then pass the crumb on every call.
 *
 * What each class gets, and why they differ:
 *
 *   ETFs         `totalAssets` — real AUM, the fund's net assets. Verified present for all 40.
 *
 *   Commodities  Neither `marketCap` nor `totalAssets` exists (Yahoo returns them empty), and that
 *                is not an upstream gap to work around — a futures contract is an *agreement*, not
 *                an ownership stake, so there is no share count to multiply by price. What does
 *                exist is `openInterest`: the number of contracts currently open. Multiplied by the
 *                price and the exchange contract size that yields **notional value** — the dollar
 *                value of all open contracts — which is the futures market's honest analogue of
 *                "how big is this", and lands in dollars so it sorts against the ETF AUM and the
 *                stock market caps in the same column.
 *
 * The whole layer is best-effort: if the crumb handshake fails, every lookup returns null, the rows
 * still carry price/change/volume from the chart endpoint, and the column falls back to the dash it
 * showed before. A dead upstream degrades the column, it never blanks the board.
 */

/** Cookie + crumb, fetched once and reused for the batch. */
let crumbCache: { at: number; cookie: string; crumb: string } | null = null;
const CRUMB_TTL_MS = 10 * 60_000;

async function getCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  if (crumbCache && Date.now() - crumbCache.at < CRUMB_TTL_MS) return crumbCache;
  try {
    const seed = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    });
    // Yahoo sets the session cookie on this throwaway request; it 404s, which is fine.
    const cookie = (seed.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');
    if (!cookie) return null;

    const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    });
    const crumb = (await res.text()).trim();
    // A crumb is a short opaque token; an HTML error page is not one.
    if (!crumb || crumb.length > 32 || crumb.includes('<')) return null;

    crumbCache = { at: Date.now(), cookie, crumb };
    return crumbCache;
  } catch {
    return null;
  }
}

/** Yahoo wraps every number as `{raw, fmt}`, and an absent field as `{}`. */
const raw = (v: unknown): number | null => {
  const n = (v as { raw?: unknown } | undefined)?.raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

interface SummaryDetail {
  totalAssets?: unknown;
  openInterest?: unknown;
}

/**
 * Yahoo rate-limits, and this layer wants a size for 56 symbols (40 ETFs + 16 futures). Firing them
 * all at once got ~a third of them throttled into nulls — which looked exactly like "upstream has no
 * data" but wasn't: every one of them returned its number when retried on its own. So requests are
 * capped to a few in flight, and a failure gets one retry.
 *
 * Semaphore rather than sequential: 56 serial round-trips would dominate the route's response time.
 */
const MAX_INFLIGHT = 4;
let inflight = 0;
const waiting: (() => void)[] = [];

async function limit<T>(job: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiting.push(r));
  inflight++;
  try {
    return await job();
  } finally {
    inflight--;
    waiting.shift()?.();
  }
}

/** One `summaryDetail` request. Null on any failure — no retry at this level. */
async function summaryOnce(ticker: string): Promise<SummaryDetail | null> {
  const auth = await getCrumb();
  if (!auth) return null;
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
        `?modules=summaryDetail&crumb=${encodeURIComponent(auth.crumb)}`,
      {
        headers: { 'User-Agent': UA, Cookie: auth.cookie, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    // 401/403 means the crumb went stale — drop it so the next call re-handshakes.
    if (res.status === 401 || res.status === 403) {
      crumbCache = null;
      return null;
    }
    if (!res.ok) return null;
    const d = (await res.json()) as {
      quoteSummary?: { result?: { summaryDetail?: SummaryDetail }[] };
    };
    return d?.quoteSummary?.result?.[0]?.summaryDetail ?? null;
  } catch {
    return null;
  }
}

/** `summaryDetail` for one ticker: rate-limited, with a single retry for a throttled first attempt. */
async function fetchSummary(ticker: string): Promise<SummaryDetail | null> {
  return limit(async () => {
    const first = await summaryOnce(ticker);
    if (first) return first;
    await new Promise((r) => setTimeout(r, 400));
    return summaryOnce(ticker);
  });
}

/** An ETF's assets under management. */
async function fetchAum(symbol: string): Promise<number | null> {
  return raw((await fetchSummary(symbol))?.totalAssets);
}

/**
 * A future's notional value: open interest × price × contract size, with a ÷100 for the contracts
 * Yahoo quotes in cents. Null when open interest is missing (CT=F is flaky), so the row degrades to
 * a dash rather than to a wrong number.
 */
async function fetchNotional(
  ticker: string,
  price: number,
  size: number,
  cents: boolean,
): Promise<number | null> {
  const oi = raw((await fetchSummary(ticker))?.openInterest);
  if (oi == null || oi <= 0) return null;
  return oi * (cents ? price / 100 : price) * size;
}

/** Settle a batch of yahooRow promises, dropping any that failed or came back priceless. */
async function settle(jobs: Promise<ScreenerRow | null>[]): Promise<ScreenerRow[]> {
  const settled = await Promise.allSettled(jobs);
  return settled
    .filter((r): r is PromiseFulfilledResult<ScreenerRow | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((r): r is ScreenerRow => r !== null);
}

/** Rank by dollar volume traded. Rows with no volume sink rather than float. Kept as the ordering
 *  even now that both classes carry a size, so the board's ranking doesn't shift under users — the
 *  size is a column to read, not the sort key. */
const byVolume = (a: ScreenerRow, b: ScreenerRow) => (b.volume ?? -1) - (a.volume ?? -1);

/** ETF rows, enriched with AUM. The size lookup is per-symbol and independent of the price fetch, so
 *  a failed AUM leaves a priced row with a dash rather than dropping it. */
const fetchETFs = () =>
  settle(
    ETFS.map(async (e) => {
      const row = await yahooRow(e.symbol, e.symbol, e.name);
      if (!row) return null;
      row.marketCap = await fetchAum(e.symbol).catch(() => null);
      return row;
    }),
  ).then((r) => r.sort(byVolume));

/** Commodity rows, enriched with notional value (open interest × price × contract size). */
const fetchCommodities = () =>
  settle(
    COMMODITIES.map(async (c) => {
      const row = await yahooRow(c.ticker, c.symbol, c.name);
      if (!row || row.price == null) return null; // yahooRow already guarantees a price; belt-and-braces.
      row.marketCap = await fetchNotional(c.ticker, row.price, c.size, !!c.cents).catch(() => null);
      return row;
    }),
  ).then((r) => r.sort(byVolume));

/* ── Handler ── */

export interface ScreenerPayload {
  stocks: ScreenerRow[];
  etfs: ScreenerRow[];
  commodities: ScreenerRow[];
  updatedAt: number;
}

let cache: { at: number; payload: ScreenerPayload } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  // Each class fails independently — one dead upstream must not blank the other two tabs.
  const [stocks, etfs, commodities] = await Promise.all([
    fetchStocks().catch(() => [] as ScreenerRow[]),
    fetchETFs().catch(() => [] as ScreenerRow[]),
    fetchCommodities().catch(() => [] as ScreenerRow[]),
  ]);

  const payload: ScreenerPayload = { stocks, etfs, commodities, updatedAt: Date.now() };

  // Don't cache a total wipeout — a transient blip would otherwise stick for the full TTL.
  if (stocks.length > 0 || etfs.length > 0 || commodities.length > 0) {
    cache = { at: Date.now(), payload };
  }

  return NextResponse.json(payload);
}
