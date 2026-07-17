// Binance source — the trading-pairs half of each report.
//
// Why this exists separately from the CMC half: CMC ranks the whole market, but an asset you can't
// actually buy on Binance isn't actionable for someone trading there. Pairs also move before the
// broader market notices, which is the "catch it starting to move" signal the report is for.
//
// Three measured facts drive the shape of this file (curl-verified, not assumed):
//
//   • GET /ticker/24hr with no params returns ~3,650 pairs / 1.9 MB. Fine server-side, never
//     proxied to the browser — only the gated top-20 ever leaves this module.
//   • That payload has NO 7d/30d field. Weekly and monthly change must be derived from klines,
//     one call per pair.
//   • GET /exchangeInfo is 17 MB. We never call it: `ticker/24hr` already carries every symbol,
//     and a symbol that's actively quoting a 24h volume is by definition trading.
//
// Cost of the klines pass, measured: 60 calls at 10-concurrent took 1.84s with zero 429s. Only ~174
// USDT pairs clear the volume floor, so a weekly/monthly pass is ~5s — comfortably inside Vercel's
// 60s Hobby limit, and ~174 request weight against Binance's 6,000/min budget.

import { PERIOD_DAYS, type Period, type RankedPair } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 10_000;
const KLINES_CONCURRENCY = 10;

/** Mirrors the CMC gate's liquidity floor: below this you can't take a position without moving it. */
const MIN_QUOTE_VOLUME = 1_000_000;
/** A five-figure percentage is a broken baseline, not a rally (same reasoning as the CMC gate). */
const MAX_ABS_CHANGE_PCT = 1000;

const TOP_N = 20;

/** Pairs to run klines against. Bounds the weekly/monthly pass; the illiquid tail was never
 *  actionable, so cutting it costs nothing real and keeps us well inside the time budget. */
const KLINES_POOL = 200;

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface RawTicker {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
}

interface LiquidPair {
  symbol: string;
  base: string;
  lastPrice: number;
  quoteVolume: number;
  change24h: number;
}

const numOf = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Every USDT pair clearing the liquidity floor, richest first.
 *
 * Stablecoin quote pairs (USDCUSDT, FDUSDUSDT…) are dropped: they're pegged, so a "gain" there is
 * peg noise, never a move worth reporting.
 */
async function fetchLiquidUsdtPairs(): Promise<LiquidPair[]> {
  const raw = (await fetchJSON('https://api.binance.com/api/v3/ticker/24hr')) as RawTicker[];
  if (!Array.isArray(raw)) return [];

  const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'EUR', 'GBP', 'AEUR']);

  return raw
    .map((t) => {
      const symbol = t.symbol ?? '';
      if (!symbol.endsWith('USDT')) return null;
      const base = symbol.slice(0, -4);
      if (!base || STABLES.has(base)) return null;
      // Leveraged tokens (BTCUPUSDT / BTCDOWNUSDT) are derivatives whose % move is a multiple of the
      // underlying — reporting them as movers would double-count the same move.
      if (base.endsWith('UP') || base.endsWith('DOWN')) return null;
      const quoteVolume = numOf(t.quoteVolume);
      const lastPrice = numOf(t.lastPrice);
      const change24h = numOf(t.priceChangePercent);
      if (!Number.isFinite(quoteVolume) || quoteVolume <= MIN_QUOTE_VOLUME) return null;
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
      if (!Number.isFinite(change24h)) return null;
      return { symbol, base, lastPrice, quoteVolume, change24h };
    })
    .filter((p): p is LiquidPair => p !== null)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

/** Percent change over `days` for one pair, from daily closes. Returns null if the candles are
 *  missing or the baseline is zero — never a fabricated number. */
async function fetchKlineChange(symbol: string, days: number): Promise<number | null> {
  // days+1 closes to span `days` of change (a 7d move needs today's close and the one 7 days back).
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${days + 1}`;
  const rows = (await fetchJSON(url)) as unknown[][];
  if (!Array.isArray(rows) || rows.length < 2) return null;
  // Kline row index 4 is the close price.
  const first = Number(rows[0]?.[4]);
  const last = Number(rows[rows.length - 1]?.[4]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return ((last - first) / first) * 100;
}

/** Resolve `changePct` for each pair over the period, capped concurrency, failing soft per pair. */
async function withKlineChange(pairs: LiquidPair[], days: number): Promise<RankedPair[]> {
  const out: RankedPair[] = [];
  let i = 0;
  async function worker() {
    while (i < pairs.length) {
      const p = pairs[i++];
      try {
        const changePct = await fetchKlineChange(p.symbol, days);
        if (changePct == null) continue;
        out.push({
          symbol: p.symbol,
          base: p.base,
          changePct,
          lastPrice: p.lastPrice,
          quoteVolume: p.quoteVolume,
        });
      } catch {
        // One dead pair drops that row; it never blanks the section.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(KLINES_CONCURRENCY, pairs.length) }, worker));
  return out;
}

/**
 * Top Binance USDT gainers for the period.
 *
 * Daily needs no klines — the bulk ticker already carries the 24h change, so it's a single call.
 * Weekly/monthly derive change from daily candles over the liquid pool.
 */
export async function fetchBinanceMovers(period: Period): Promise<RankedPair[]> {
  const liquid = await fetchLiquidUsdtPairs();
  if (liquid.length === 0) return [];

  let ranked: RankedPair[];
  if (period === 'daily') {
    ranked = liquid.map((p) => ({
      symbol: p.symbol,
      base: p.base,
      changePct: p.change24h,
      lastPrice: p.lastPrice,
      quoteVolume: p.quoteVolume,
    }));
  } else {
    // PERIOD_DAYS is the single definition of the window; inlining `7 : 30` here would be a second
    // copy free to drift from it.
    ranked = await withKlineChange(liquid.slice(0, KLINES_POOL), PERIOD_DAYS[period]);
  }

  return ranked
    .filter((p) => p.changePct > 0 && Math.abs(p.changePct) <= MAX_ABS_CHANGE_PCT)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, TOP_N);
}
