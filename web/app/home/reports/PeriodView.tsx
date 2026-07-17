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

const TITLE: Record<Period, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const WINDOW: Record<Period, string> = {
  daily: 'Top 20 gainers over the last 24 hours',
  weekly: 'Top 20 gainers over the last 7 days',
  monthly: 'Top 20 gainers over the last 30 days',
};
const CHANGE_LABEL: Record<Period, string> = { daily: '24h %', weekly: '7d %', monthly: '30d %' };

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
        <button className="gl-refresh-btn" onClick={() => void load()} disabled={loading}>
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
            <Icon name="trending-up" size={15} />
            Top Gainers · CoinMarketCap
            <span className="gl-section-badge">{coins.length}</span>
          </div>
          <div className="gl-table-wrapper">
            <table className="gl-cmc-table rp-table">
              <thead>
                <tr>
                  <th className="gl-th-rank">#</th>
                  <th className="gl-th-name">Name</th>
                  <th className="gl-th-price">Price</th>
                  <th className="gl-th-change">{CHANGE_LABEL[period]}</th>
                  <th className="gl-th-mcap">Market Cap</th>
                  <th className="gl-th-volume">Volume(24h)</th>
                </tr>
              </thead>
              <tbody>
                {coins.map((c) => {
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

        {/* ── Binance pairs ── */}
        <div className="gl-section-block">
          <div className="gl-section-header gainers">
            <Icon name="bar-chart" size={15} />
            Top Gainers · Binance USDT pairs
            <span className="gl-section-badge">{binancePairs.length}</span>
          </div>
          <div className="gl-table-wrapper">
            <table className="gl-cmc-table">
              <thead>
                <tr>
                  <th className="gl-th-name">Pair</th>
                  <th className="gl-th-price">Last</th>
                  <th className="gl-th-change">{CHANGE_LABEL[period]}</th>
                  <th className="gl-th-volume">Volume(24h)</th>
                </tr>
              </thead>
              <tbody>
                {binancePairs.map((p) => (
                  <tr className="gl-cmc-row" key={p.symbol}>
                    <td className="gl-td-name">
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
                {binancePairs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="rp-empty">
                      No Binance pairs cleared the liquidity filter for this period.
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
