'use client';

// Portfolio value history derived from market klines, so the History chart shows the real
// movement of the current holdings over the whole selected period — not just the snapshots
// recorded while the app happened to be open. Mirrored by portfolioSeries.logic.test.mjs.

import { useEffect, useMemo, useState } from 'react';
import type { Holding } from './holdings';

export interface SeriesPoint {
  t: number;
  close: number;
}

export type SeriesMap = Record<string, SeriesPoint[] | undefined>;

/**
 * Sums amount × price at each grid timestamp.
 *
 * - Grid = the in-range timestamps of whichever symbol's series has the most in-range points
 *   (the densest upstream — crypto candles when present). Returns [] when no series has ≥2
 *   in-range points so the caller can fall back to snapshots.
 * - A holding's price at time t is its last close at/before t (flat backfill before the first).
 * - Holdings without history contribute their live price flat, so the total still tracks the
 *   assets that do have data instead of dropping value.
 */
export function buildPortfolioSeries(
  holdings: { symbol: string; amount: number }[],
  seriesBySymbol: SeriesMap,
  livePrices: Record<string, number>,
  cutoff: number,
  now: number,
  liveValue: number,
): { t: number; value: number }[] {
  let grid: number[] = [];
  for (const sym of Object.keys(seriesBySymbol)) {
    const inRange = (seriesBySymbol[sym] ?? []).filter((p) => p.t >= cutoff && p.t <= now);
    if (inRange.length > grid.length) grid = inRange.map((p) => p.t);
  }
  if (grid.length < 2) return [];

  const out = grid.map((t) => {
    let value = 0;
    for (const h of holdings) {
      const pts = seriesBySymbol[h.symbol];
      if (!pts || pts.length === 0) {
        value += h.amount * (livePrices[h.symbol] ?? 0);
        continue;
      }
      // Last point at/before t; before the first point, backfill flat with the first close.
      let lo = 0;
      let hi = pts.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].t <= t) {
          idx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      value += h.amount * pts[idx === -1 ? 0 : idx].close;
    }
    return { t, value };
  });

  if (liveValue > 0 && now > out[out.length - 1].t) out.push({ t: now, value: liveValue });
  return out;
}

/**
 * Fetches per-holding kline history for a period from /api/market/klines (POST). Re-fetches when
 * the set of symbols or the range changes; the route caches upstream responses for 5 minutes.
 */
export function usePortfolioHistory(holdings: Holding[], rangeKey: string): SeriesMap {
  const [series, setSeries] = useState<SeriesMap>({});
  // Key on the distinct (symbol, type) pairs, not the holdings array identity — amount edits and
  // price polls must not re-trigger the fetch.
  const assetsKey = useMemo(
    () =>
      JSON.stringify(
        [...new Map(holdings.map((h) => [h.symbol, { symbol: h.symbol, asset_type: h.asset_type }])).values()].sort(
          (a, b) => (a.symbol < b.symbol ? -1 : 1),
        ),
      ),
    [holdings],
  );

  useEffect(() => {
    const assets = JSON.parse(assetsKey) as { symbol: string; asset_type: string }[];
    if (assets.length === 0) {
      setSeries({});
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/market/klines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ range: rangeKey, assets }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { series?: SeriesMap };
        if (alive && data.series) setSeries(data.series);
      } catch {
        // No market history this time — the charts fall back to recorded snapshots.
      }
    })();
    return () => {
      alive = false;
    };
  }, [assetsKey, rangeKey]);

  return series;
}
