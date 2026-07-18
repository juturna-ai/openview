// Composes one report: fetch → gate → rank → analyze.
//
// Shared by the preview route (Phase 1) and, once the Supabase project exists, by the cron and the
// manual generate route — so a report is built exactly one way regardless of what triggered it.
//
// Fail-soft throughout, same principle as the market routes: a dead upstream costs its own section,
// never the whole report. The one thing that must never happen is a report that *looks* complete
// while carrying data that isn't — hence null analysis over invented analysis, and an empty coins
// list over an ungated one.

import { fetchBinanceMovers } from './binance';
import { fetchDeepThumbs, fetchListing, fetchSentiment } from './cmc';
import { gateAndRank } from './gate';
import { analyze } from './llm';
import { canWrite, upsertRow } from './supabase';
import type { Period, RankedCoin, RankedPair, Report, Sentiment } from './types';

const EMPTY_SENTIMENT: Sentiment = {
  fearGreed: null,
  trending: [],
  mostVisited: [],
  recentlyAdded: [],
};

/** UTC calendar date, YYYY-MM-DD. The report's identity, and the cron's idempotency key. */
export const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

export async function buildReport(period: Period, at: Date = new Date()): Promise<Report> {
  // The three sources are independent; one failing must not take the others down with it.
  const [coins, rawPairs, sentiment] = await Promise.all([
    fetchListing().catch(() => []),
    fetchBinanceMovers(period).catch(() => [] as RankedPair[]),
    fetchSentiment().catch(() => EMPTY_SENTIMENT),
  ]);

  // Binance's API carries no logos; borrow the CMC listing's thumb where the base symbol matches.
  // First match wins: the listing is market-cap-ordered, so a symbol collision resolves to the
  // larger coin.
  const thumbBySymbol = new Map<string, string>();
  for (const c of coins) if (c.symbol && !thumbBySymbol.has(c.symbol)) thumbBySymbol.set(c.symbol, c.thumb);
  let binancePairs: RankedPair[] = rawPairs.map((p) => ({
    ...p,
    thumb: thumbBySymbol.get(p.base),
  }));

  // Long-tail bases (ranks 501–1500): one extra listing page, thumbs only, failing soft. Anything
  // still unmatched (CMC-delisted/renamed bases like COCOS, TOMO) gets Binance's own logo CDN,
  // which is keyed by base symbol and covers everything Binance trades (curl-verified; an unknown
  // symbol 403s and CoinIcon degrades to its initial chip).
  if (binancePairs.some((p) => !p.thumb)) {
    const deep = await fetchDeepThumbs().catch(() => new Map<string, string>());
    binancePairs = binancePairs.map((p) =>
      p.thumb
        ? p
        : { ...p, thumb: deep.get(p.base) ?? `https://bin.bnbstatic.com/static/assets/logos/${p.base}.png` },
    );
  }

  // The gate is what makes this a report rather than a list of broken microcaps. See gate.ts.
  const ranked: RankedCoin[] = gateAndRank(coins, period);

  // analyze() never throws and returns a null analysis if the model can't produce a valid one —
  // the report still ships with its data.
  const { analysis, provider } = await analyze(period, ranked, binancePairs, sentiment);

  return {
    period,
    reportDate: utcDate(at),
    coins: ranked,
    binancePairs,
    sentiment,
    analysis,
    llmProvider: provider,
    generatedAt: at.getTime(),
  };
}

/**
 * Build a report and persist it, upserting on (period, report_date).
 *
 * Shared by the cron and the manual generate route so a report is produced exactly one way
 * regardless of trigger. The upsert is what makes a cron retry safe (Vercel does not promise
 * at-most-once delivery) and lets "generate now" refresh the day's report rather than duplicate it.
 *
 * A report with zero coins is still saved: that's a real, informative state (upstream was down),
 * and skipping the write would leave the feed silently missing a day.
 */
export async function buildAndSaveReport(
  period: Period,
  at: Date = new Date(),
): Promise<{ report: Report; saved: boolean }> {
  const report = await buildReport(period, at);

  if (!canWrite()) return { report, saved: false };

  await upsertRow(
    'reports',
    {
      period: report.period,
      report_date: report.reportDate,
      coins: report.coins,
      binance_pairs: report.binancePairs,
      sentiment: report.sentiment,
      analysis: report.analysis,
      llm_provider: report.llmProvider,
      updated_at: new Date(report.generatedAt).toISOString(),
    },
    'period,report_date',
  );

  return { report, saved: true };
}
