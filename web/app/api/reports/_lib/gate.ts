// The quality gate — the core of the Reports feature.
//
// CMC's listing endpoint only ever sorts by market cap, so gainers must be ranked in-process (the
// same thing MoversView does for the Gainers & Losers board). But ranking the raw pool by percent
// change produces garbage: a live pull of the 30d window put ANSEM at +152,296% and CASHCAT at
// +8,486% in the top two slots. Those aren't opportunities — they're near-zero-baseline microcaps
// and listing artifacts, where a $0.0000001 → $0.0001 tick reads as a five-figure percentage.
//
// A report built on that is worse than no report: it's noise that an LLM will then confidently
// narrate. The whole point is catching real assets *as they start to move*, which is the opposite
// of coins that already printed a 1,500x. So the pool is gated before it's ranked.
//
// The thresholds are deliberately strict and deliberately named — they're the difference between a
// useful report and a memecoin lottery ticket, and they're easy to silently drift. Change them only
// on purpose.

// Type-only imports (erased at runtime) plus a locally-declared CHANGE_KEY, so this module pulls in
// no sibling values at runtime and stays importable under plain `node` for gate.logic.test.mjs —
// matching how every other .ts file under test in this repo is kept self-contained.
import type { Coin } from './cmc';
import type { Period, RankedCoin } from './types';

/** Which CMC percent-change field each period ranks on. Declared here (not in types.ts) so this
 *  module stays runtime-dependency-free; types.ts re-exports it, so there's still one definition. */
export const CHANGE_KEY: Record<Period, 'change24h' | 'change7d' | 'change30d'> = {
  daily: 'change24h',
  weekly: 'change7d',
  monthly: 'change30d',
};

/** Below this the coin is too small for its percent change to mean anything. */
export const MIN_MARKET_CAP = 10_000_000;
/** Below this you couldn't take a position without moving the price yourself. */
export const MIN_VOLUME_24H = 1_000_000;
/** Outside the top 500 by market cap, data quality drops off sharply. */
export const MAX_CMC_RANK = 500;
/** Above this it's a listing artifact or a near-zero baseline, not a move. */
export const MAX_ABS_CHANGE_PCT = 1000;

export const TOP_N = 20;

/**
 * Filter the pool to coins whose move is real and tradeable, then rank by the period's change.
 *
 * Every rejection here is a deliberate judgment that the row would mislead rather than inform.
 */
export function gateAndRank(coins: Coin[], period: Period, topN = TOP_N): RankedCoin[] {
  const key = CHANGE_KEY[period];

  return coins
    .filter((c) => {
      const change = c[key];
      // Nothing to rank on.
      if (change == null || !Number.isFinite(change)) return false;
      // Only gainers — this is a gainers report.
      if (change <= 0) return false;
      // A five-figure percentage is a broken baseline, not a rally.
      if (Math.abs(change) > MAX_ABS_CHANGE_PCT) return false;
      // Floors are exclusive (strictly greater), matching the documented "> $10M / > $1M" spec.
      if (c.marketCap == null || c.marketCap <= MIN_MARKET_CAP) return false;
      if (c.volume == null || c.volume <= MIN_VOLUME_24H) return false;
      if (c.cmcRank == null || c.cmcRank > MAX_CMC_RANK) return false;
      return true;
    })
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
    .slice(0, topN)
    .map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      slug: c.slug,
      thumb: c.thumb,
      cmcRank: c.cmcRank,
      price: c.price,
      changePct: c[key] as number,
      volume: c.volume as number,
      marketCap: c.marketCap as number,
      turnover: (c.volume as number) / (c.marketCap as number),
    }));
}
