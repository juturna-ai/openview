'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CoinIcon from '../wallet/CoinIcon';
import { Icon } from '../wallet/icons';
import { getReport, setReport } from './dataCache';

// One period's report — the CMC top-20, the Binance pairs, and the model's read of both.
//
// Reuses the Gainers & Losers board's table vocabulary (.gl-cmc-table, .gl-change-pill, …) rather
// than inventing a second table style, so a report row looks and reads exactly like a board row.
//
// The report itself is built server-side (see app/api/reports/preview/route.ts). This view is a
// renderer: it never computes a ranking, so the quality gate can't be bypassed from the client.

type Period = 'daily' | 'weekly' | 'monthly';

interface RankedCoin {
  id: number;
  symbol: string;
  name: string;
  thumb: string;
  cmcRank: number | null;
  price: number | null;
  changePct: number;
  volume: number;
  marketCap: number;
  turnover: number;
}

interface RankedPair {
  symbol: string;
  base: string;
  changePct: number;
  lastPrice: number;
  quoteVolume: number;
  /** Absent on reports stored before the field existed; CoinIcon then falls back to a chip. */
  thumb?: string;
}

interface Report {
  /** Present only on stored reports; absent on a live preview (which has no DB row). */
  id?: string;
  period: Period;
  reportDate: string;
  coins: RankedCoin[];
  binancePairs: RankedPair[];
  /** Every field optional: the DB column defaults to `{}` and the read routes pass it through as
   *  `?? {}`, so the full shape is a convention of the current writer, not a guarantee of the data.
   *  Declaring it required would be a type that lies — and `.trending.length` would throw. */
  sentiment: {
    fearGreed?: { value: number; classification: string } | null;
    trending?: string[];
    mostVisited?: string[];
    recentlyAdded?: string[];
  };
  analysis: {
    summary: string;
    coinTheses: { symbol: string; thesis: string }[];
    riskFlags: string[];
    disclaimer: string;
  } | null;
  llmProvider: string | null;
  generatedAt: number;
}

/** Which exchange the pairs table shows. Binance is the report's own baked, period-correct data;
 *  Coinbase and Bybit are fetched live from /api/market/exchange-movers when their tab opens. */
type ExVenue = 'binance' | 'coinbase' | 'bybit';

const VENUES: { key: ExVenue; label: string }[] = [
  { key: 'binance', label: 'Binance' },
  { key: 'coinbase', label: 'Coinbase' },
  { key: 'bybit', label: 'Bybit' },
];

const VENUE_HEADER: Record<ExVenue, string> = {
  binance: 'Binance USDT pairs',
  coinbase: 'Coinbase spot',
  bybit: 'Bybit spot',
};

/** Same liquidity floor as the report's Binance list (_lib/binance.ts MIN_QUOTE_VOLUME). */
const VENUE_MIN_VOLUME = 1_000_000;

/** One exchange ticker row as /api/market/exchange-movers returns it. */
interface ExchangeRow {
  symbol: string;
  pair: string;
  price: number | null;
  change24h: number | null;
  volume: number | null;
}

const TITLE: Record<Period, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const WINDOW: Record<Period, string> = {
  daily: 'Top 20 gainers over the last 24 hours',
  weekly: 'Top 20 gainers over the last 7 days',
  monthly: 'Top 20 gainers over the last 30 days',
};
const CHANGE_LABEL: Record<Period, string> = { daily: '24h %', weekly: '7d %', monthly: '30d %' };

/** The official CoinMarketCap mark in brand blue — the circled "M" wave from CMC's brand kit. */
const CmcMark = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#3861FB" aria-hidden="true">
    <path d="M20.738 14.341c-.419.265-.912.298-1.286.087-.476-.27-.738-.898-.738-1.774v-2.618c0-1.264-.5-2.164-1.336-2.407-1.416-.413-2.482 1.32-2.882 1.972l-2.498 4.05v-4.95c-.028-1.14-.398-1.821-1.1-2.027-.466-.135-1.161-.081-1.837.953l-5.597 8.987A9.875 9.875 0 0 1 2.326 12c0-5.414 4.339-9.818 9.672-9.818 5.332 0 9.67 4.404 9.67 9.818.004.026.002.049.003.075.05 1.048-.29 1.882-.933 2.266zM24 12.001v-.028C23.984 5.376 18.594 0 11.998 0 5.394 0 0 5.383 0 12s5.394 12.001 11.998 12.001c3.03 0 5.923-1.136 8.146-3.197a1.168 1.168 0 0 0 .063-1.652 1.17 1.17 0 0 0-1.654-.064 9.628 9.628 0 0 1-6.555 2.575c-2.853 0-5.42-1.238-7.19-3.2l5.045-8.105v3.741c0 1.797.708 2.378 1.302 2.548.594.17 1.503.054 2.456-1.493l2.776-4.5c.088-.145.17-.27.244-.377v2.297c0 1.68.683 3.023 1.877 3.696 1.075.607 2.428.552 3.53-.145C23.939 15.311 24.502 13.775 24 12.001z" />
  </svg>
);

/** The official Binance five-diamond mark in brand gold — same geometry as the `bsc` icon in
 *  app/home/wallet/chainIcons.ts, drawn flat here (no disc) to sit in a section header. */
const BinanceMark = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 100 100" width={size} height={size} fill="#F0B90B" aria-hidden="true">
    <path d="M30.58 42.02 50 22.6l19.43 19.43 11.3-11.3L50 0 19.28 30.72z" />
    <path d="M0 50l11.3-11.3L22.6 50 11.3 61.3z" />
    <path d="M77.4 50l11.3-11.3L100 50 88.7 61.3z" />
    <path d="M30.58 57.98 50 77.4l19.43-19.43 11.31 11.32L50 100 19.28 69.28z" />
    <path d="M61.46 50 50 38.53 38.53 50 50 61.47z" />
  </svg>
);

/* ── Formatters (same behaviour as MoversView's, so report rows match board rows) ── */

const fmtPrice = (p: number | null): string => {
  if (p == null) return '—';
  if (p < 0.001) return `$${p.toFixed(8)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  if (p < 100) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const fmtVol = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtMcap = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

/* ── Column sorting (same interaction as MoversView: click to sort, click again to flip) ── */

type SortDir = 'asc' | 'desc';
interface SortState {
  key: string | null;
  dir: SortDir;
}

/** Rank and the alphabetic columns read best/A-first, so they open ascending; every numeric
 *  column opens descending (biggest first). */
const ASC_FIRST = new Set(['cmcRank', 'rank', 'name', 'symbol']);

const cycleSort = (prev: SortState, key: string): SortState => {
  const firstDir: SortDir = ASC_FIRST.has(key) ? 'asc' : 'desc';
  if (prev.key !== key) return { key, dir: firstDir };
  return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
};

/** Resort a report's rows by one column. Strings compare alphabetically; a missing numeric field
 *  sorts as 0 — except rank, where 0 would float unranked coins to the top of an ascending sort,
 *  so they sink to the bottom instead (same reasoning as MoversView's sortList). */
function sortRows<T>(rows: T[], sort: SortState): T[] {
  if (!sort.key) return rows;
  const k = sort.key;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const missing = k === 'cmcRank' ? Infinity : 0;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
    const x = typeof av === 'number' && Number.isFinite(av) ? av : missing;
    const y = typeof bv === 'number' && Number.isFinite(bv) ? bv : missing;
    // Compare rather than subtract: two Infinity ranks subtract to NaN, breaking the comparator.
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

function ChangePill({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="gl-change-pill">—</span>;
  const pos = pct >= 0;
  return (
    <span className={'gl-change-pill ' + (pos ? 'positive' : 'negative')}>
      <Icon name={pos ? 'trending-up' : 'trending-down'} size={11} />
      {/* The '+' matters: MoversView's pill and the feed card's chips both show it, so omitting it
          here made the same coin read "+12.3%" on the card and "12.3%" in the table. */}
      {pos ? '+' : ''}
      {pct.toFixed(2)}%
    </span>
  );
}

export default function PeriodView({ period }: { period: Period }) {
  // Seeded from the module cache so a tab revisit paints the last report immediately instead of
  // flashing a loading state while the fetch settles.
  const [report, setReportState] = useState<Report | null>(() => getReport<Report>(period));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // One sort per table — sorting the CMC list shouldn't reorder the Binance one.
  const [cmcSort, setCmcSort] = useState<SortState>({ key: null, dir: 'desc' });
  const [pairSort, setPairSort] = useState<SortState>({ key: null, dir: 'desc' });

  // Exchange tab over the pairs table. Coinbase/Bybit lists are fetched on first open and kept for
  // the mount; the report itself is untouched — only the Binance tab shows baked report data.
  const [venue, setVenue] = useState<ExVenue>('binance');
  const [venuePairs, setVenuePairs] = useState<Partial<Record<ExVenue, RankedPair[]>>>({});
  const [venueLoading, setVenueLoading] = useState(false);

  const fetchVenue = useCallback(async (v: ExVenue) => {
    if (v === 'binance') return;
    setVenueLoading(true);
    try {
      const d = await fetch(`/api/market/exchange-movers?venue=${v}`).then((r) =>
        r.ok ? r.json() : null,
      );
      const rows = (d?.rows ?? []) as ExchangeRow[];
      // Same derivation as the report's Binance list: liquidity floor, gainers only, top 20 —
      // shaped into RankedPair so the one table renderer serves all three venues.
      const ranked: RankedPair[] = rows
        .filter((r) => (r.volume ?? 0) > VENUE_MIN_VOLUME && (r.change24h ?? 0) > 0)
        .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
        .slice(0, 20)
        .map((r) => ({
          symbol: r.pair,
          base: r.symbol,
          changePct: r.change24h ?? 0,
          lastPrice: r.price ?? 0,
          quoteVolume: r.volume ?? 0,
        }));
      setVenuePairs((m) => ({ ...m, [v]: ranked }));
    } catch {
      // Keep the tab empty rather than erroring the whole report view.
    } finally {
      setVenueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (venue === 'binance' || venuePairs[venue]) return;
    void fetchVenue(venue);
  }, [venue, venuePairs, fetchVenue]);

  // A sort keyed to one venue's rows means nothing on another's.
  useEffect(() => {
    setPairSort({ key: null, dir: 'desc' });
  }, [venue]);

  /**
   * Prefer the stored report the cron generated; fall back to building one live.
   *
   * The fallback is what keeps this working before the database is configured (and if a cron run is
   * ever missed) — the tab shows a real report either way, it just isn't persisted or shareable.
   */
  // Latest-load-wins: on a first empty-cache visit the mount fetch and a manual
  // Refresh can overlap, and the slower (staler) one must not overwrite the result.
  const loadSeq = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(false);
      try {
        const stored = await fetch(`/api/reports/list?period=${period}&limit=1`, { signal })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (seq !== loadSeq.current) return;

        const hit = stored?.reports?.[0] as Report | undefined;
        if (hit) {
          setReport(period, hit);
          setReportState(hit);
          return;
        }

        const res = await fetch(`/api/reports/preview?period=${period}`, { signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Report;
        if (seq !== loadSeq.current) return;
        setReport(period, data);
        setReportState(data);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        if (seq === loadSeq.current) setError(true);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    // Already have a report from a previous mount — the server caches for hours, so don't re-ask.
    if (report) return;
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
    // Intentionally runs once per mount: reports change a few times a day, not on a poll. Refresh
    // is manual (the button below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const thesisFor = (symbol: string): string | null =>
    report?.analysis?.coinTheses.find((t) => t.symbol === symbol)?.thesis ?? null;

  /** Logo for a Binance pair. Prefers the thumb baked in at build time; reports stored before that
   *  field existed fall back to a same-symbol match against this report's own CMC rows, then to
   *  Binance's own symbol-keyed logo CDN (covers everything Binance trades; a miss 403s and
   *  CoinIcon degrades to its initial chip). */
  const pairThumb = (p: RankedPair): string =>
    p.thumb ??
    report?.coins.find((c) => c.symbol === p.base)?.thumb ??
    `https://bin.bnbstatic.com/static/assets/logos/${p.base}.png`;

  if (!report && loading) return <p className="gl-page-loading">Building report…</p>;

  if (!report) {
    return (
      <div className="gl-page">
        <div className="gl-page-header">
          <h1 className="gl-page-title">{TITLE[period]} Report</h1>
          <p className="gl-page-subtitle">{WINDOW[period]}</p>
        </div>
        <p className="gl-page-loading">
          {error ? 'Could not build this report right now.' : 'No report yet.'}{' '}
          <button className="rp-inline-btn" onClick={() => void load()}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  const { coins, binancePairs, sentiment, analysis } = report;
  const sortedCoins = sortRows(coins, cmcSort);
  // Gainer position in the server-built ranking (already sorted by the period's change) — pairs
  // have no market-wide rank like cmcRank, so the report's own 1..N ordering is the number shown.
  // Baked onto the row before sorting so the # column sorts like any other.
  const activePairs = venue === 'binance' ? binancePairs : (venuePairs[venue] ?? []);
  const sortedPairs = sortRows(
    activePairs.map((p, i) => ({ ...p, rank: i + 1 })),
    pairSort,
  );
  // Exchange tickers only publish 24h stats, so the live tabs are 24h whatever the period; only
  // the report's own Binance list carries the period's window.
  const pairChangeLabel = venue === 'binance' ? CHANGE_LABEL[period] : '24h %';

  const sortableTh = (
    sort: SortState,
    onSort: React.Dispatch<React.SetStateAction<SortState>>,
    key: string,
    label: string,
    cls: string,
  ) => (
    <th className={cls + ' gl-sortable'} onClick={() => onSort((prev) => cycleSort(prev, key))}>
      {label} <Icon name="arrow-up-down" size={10} />
    </th>
  );
  // Defaulted once here rather than guarded at each use — sentiment is stored as jsonb and may
  // legitimately be `{}` (see the type above).
  const trending = sentiment.trending ?? [];
  const mostVisited = sentiment.mostVisited ?? [];

  return (
    <div className="gl-page">
      <div className="gl-page-header">
        <h1 className="gl-page-title">{TITLE[period]} Report</h1>
        <p className="gl-page-subtitle">
          {WINDOW[period]} · {report.reportDate}
        </p>
      </div>

      <div className="rp-toolbar">
        <button
          className="gl-refresh-btn"
          onClick={() => {
            void load();
            // The live exchange tabs aren't part of the report payload — refresh whichever is open.
            if (venue !== 'binance') void fetchVenue(venue);
          }}
          disabled={loading}
        >
          <span className={loading ? 'spinning' : undefined}>
            <Icon name="refresh-cw" size={14} />
          </span>
          Refresh
        </button>
        {sentiment.fearGreed && (
          <span className="rp-meta">
            Fear &amp; Greed {sentiment.fearGreed.value} · {sentiment.fearGreed.classification}
          </span>
        )}
        <span className="rp-meta">
          Generated {new Date(report.generatedAt).toLocaleString()}
          {report.llmProvider ? ` · analysis by ${report.llmProvider}` : ''}
        </span>
      </div>

      {/* ── The model's read. Absent rather than faked when the LLM couldn't produce a valid one. ── */}
      {analysis ? (
        <section className="rp-analysis">
          <h2 className="rp-analysis-title">Analysis</h2>
          <p className="rp-summary">{analysis.summary}</p>
          {analysis.riskFlags.length > 0 && (
            <ul className="rp-risks">
              {analysis.riskFlags.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="rp-analysis">
          <p className="rp-summary rp-muted">
            Analysis unavailable for this report — showing data only.
          </p>
        </section>
      )}

      {/* rp-sections stacks the two sources full-width instead of inheriting the board's paired
          side-by-side grid — see globals.css for why the thesis rows need the room. */}
      <div className="gl-sections rp-sections">
        {/* ── CoinMarketCap ── */}
        <div className="gl-section-block">
          <div className="gl-section-header gainers">
            <CmcMark size={16} />
            Top Gainers · CoinMarketCap
            <span className="gl-section-badge">{coins.length}</span>
          </div>
          <div className="gl-table-wrapper">
            <table className="gl-cmc-table rp-table">
              <thead>
                <tr>
                  {sortableTh(cmcSort, setCmcSort, 'cmcRank', '#', 'gl-th-rank')}
                  {sortableTh(cmcSort, setCmcSort, 'name', 'Name', 'gl-th-name')}
                  {sortableTh(cmcSort, setCmcSort, 'price', 'Price', 'gl-th-price')}
                  {sortableTh(cmcSort, setCmcSort, 'changePct', CHANGE_LABEL[period], 'gl-th-change')}
                  {sortableTh(cmcSort, setCmcSort, 'marketCap', 'Market Cap', 'gl-th-mcap')}
                  {sortableTh(cmcSort, setCmcSort, 'volume', 'Volume(24h)', 'gl-th-volume')}
                </tr>
              </thead>
              <tbody>
                {sortedCoins.map((c) => {
                  const thesis = thesisFor(c.symbol);
                  return (
                    <React.Fragment key={c.id}>
                      <tr className="gl-cmc-row">
                        {/* The coin's real CMC rank, not a row counter — the row is ranked by
                            change here, so numbering 1..20 would misreport its market position. */}
                        <td className="gl-td-rank">{c.cmcRank ?? '—'}</td>
                        <td className="gl-td-name">
                          <CoinIcon symbol={c.symbol} thumb={c.thumb} size={28} />
                          <span className="gl-coin-info">
                            <span className="gl-coin-name">{c.name}</span>
                            <span className="gl-coin-symbol">{c.symbol}</span>
                          </span>
                        </td>
                        <td className="gl-td-price">{fmtPrice(c.price)}</td>
                        <td className="gl-td-change">
                          <ChangePill pct={c.changePct} />
                        </td>
                        <td className="gl-td-mcap">{fmtMcap(c.marketCap)}</td>
                        <td className="gl-td-volume">{fmtVol(c.volume)}</td>
                      </tr>
                      {thesis && (
                        <tr className="rp-thesis-row">
                          <td />
                          <td colSpan={5}>{thesis}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {coins.length === 0 && (
                  <tr>
                    <td colSpan={6} className="rp-empty">
                      No coins cleared the quality filters for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Exchange pairs (Binance from the report; Coinbase/Bybit live) ── */}
        <div className="gl-section-block">
          <div className="gl-class-tabs" role="tablist" aria-label="Exchange">
            {VENUES.map((v) => (
              <button
                key={v.key}
                role="tab"
                className={'gl-class-tab' + (venue === v.key ? ' active' : '')}
                onClick={() => setVenue(v.key)}
                aria-selected={venue === v.key}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="gl-section-header gainers">
            {venue === 'binance' ? <BinanceMark size={16} /> : <Icon name="coins" size={16} />}
            Top Gainers · {VENUE_HEADER[venue]}
            <span className="gl-section-badge">{activePairs.length}</span>
          </div>
          <div className="gl-table-wrapper">
            <table className="gl-cmc-table">
              <thead>
                <tr>
                  {sortableTh(pairSort, setPairSort, 'rank', '#', 'gl-th-rank')}
                  {sortableTh(pairSort, setPairSort, 'symbol', 'Pair', 'gl-th-name')}
                  {sortableTh(pairSort, setPairSort, 'lastPrice', 'Last', 'gl-th-price')}
                  {sortableTh(pairSort, setPairSort, 'changePct', pairChangeLabel, 'gl-th-change')}
                  {sortableTh(pairSort, setPairSort, 'quoteVolume', 'Volume(24h)', 'gl-th-volume')}
                </tr>
              </thead>
              <tbody>
                {sortedPairs.map((p) => (
                  <tr className="gl-cmc-row" key={p.symbol}>
                    <td className="gl-td-rank">{p.rank}</td>
                    <td className="gl-td-name">
                      <CoinIcon symbol={p.base} thumb={pairThumb(p)} size={28} />
                      <span className="gl-coin-info">
                        <span className="gl-coin-name">{p.symbol}</span>
                        <span className="gl-coin-symbol">{p.base}</span>
                      </span>
                    </td>
                    <td className="gl-td-price">{fmtPrice(p.lastPrice)}</td>
                    <td className="gl-td-change">
                      <ChangePill pct={p.changePct} />
                    </td>
                    <td className="gl-td-volume">{fmtVol(p.quoteVolume)}</td>
                  </tr>
                ))}
                {activePairs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="rp-empty">
                      {venue !== 'binance' && venueLoading
                        ? 'Loading…'
                        : venue === 'binance'
                          ? 'No Binance pairs cleared the liquidity filter for this period.'
                          : `No ${VENUE_HEADER[venue]} pairs cleared the liquidity filter right now.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(trending.length > 0 || mostVisited.length > 0) && (
        <p className="rp-meta">
          {trending.length > 0 && <>Trending: {trending.slice(0, 8).join(', ')}. </>}
          {mostVisited.length > 0 && <>Most visited: {mostVisited.slice(0, 8).join(', ')}.</>}
        </p>
      )}

      <p className="gl-page-disclaimer">
        {analysis?.disclaimer ??
          'Market data for informational purposes only. Not investment advice. Cryptocurrency markets are highly volatile; verify all data independently before making decisions.'}
      </p>
    </div>
  );
}
