// Module-level in-memory cache of the last report fetched for each period.
//
// Same idea and same deliberate limits as wallet/dataCache.ts: a tiny last-value store so a view
// seeds its initial state and a revisit paints instantly instead of flashing "Loading…". It lives
// only for the browser session, holds only already-public market data, and never gates a fetch —
// the Refresh button always re-asks, so a stale entry can only remove the empty flash, never
// prevent an update.
//
// The shell already keeps the period views mounted, so this mainly covers leaving /home/reports and
// coming back (which unmounts the whole shell).

/** Structural only — PeriodView owns the authoritative Report shape. */
type CachedReport = unknown;

const reports: Record<string, CachedReport> = {};
let feed: CachedReport[] | null = null;

export function getReport<T = CachedReport>(period: string): T | null {
  return (reports[period] as T) ?? null;
}

export function setReport(period: string, report: CachedReport) {
  reports[period] = report;
}

/** The Dashboard's report list. */
export function getFeed<T = CachedReport>(): T[] | null {
  return (feed as T[]) ?? null;
}

export function setFeed(list: CachedReport[]) {
  feed = list;
}
