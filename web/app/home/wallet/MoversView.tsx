'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AssetIcon from './AssetIcon';
import CoinIcon from './CoinIcon';
import { Icon } from './icons';

// Market page — ported from Reach's GainersLosers.jsx.
//
// Reach's six tabs are crypto, all sourced from CoinMarketCap via /api/market/cmc (see that route
// for why it needs no API key). Two further tabs — Metals and Stocks/ETFs — are ours, sourced from
// /api/market/movers (Yahoo + Frankfurter); Reach has no equivalent.
//
// One deliberate divergence from Reach: its Community Sentiment table wires up sortable column
// headers but then renders `list.map(...)` instead of `sortList(list).map(...)`, so clicking them
// updates state and does nothing visible. Here every table sorts through the same `sortList`, so the
// headers actually work.

interface Coin {
  id: number;
  cmcRank: number | null;
  symbol: string;
  name: string;
  price: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  volume: number | null;
  marketCap: number | null;
  thumb: string;
}

interface FearGreed {
  value: number;
  classification: string;
}

interface MoverRow {
  symbol: string;
  name: string;
  assetType: 'metal' | 'currency' | 'stock';
  price: number;
  change24h: number;
  volume: number | null;
}

type TabKey =
  | 'leaderboards'
  | 'gainerslosers'
  | 'trending'
  | 'mostvisited'
  | 'recentlyadded'
  | 'sentiment'
  | 'metals'
  | 'stocks';

type ChangeKey = 'change1h' | 'change24h' | 'change7d' | 'change30d';
type SortKey = 'price' | 'volume' | 'marketCap' | ChangeKey;

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy' },
  { key: 'gainerslosers', label: 'Gainers & Losers', icon: 'bar-chart' },
  { key: 'trending', label: 'Trending', icon: 'flame' },
  { key: 'mostvisited', label: 'Most Visited', icon: 'eye' },
  { key: 'recentlyadded', label: 'Recently Added', icon: 'clock' },
  { key: 'sentiment', label: 'Community Sentiment', icon: 'users' },
  { key: 'metals', label: 'Metals', icon: 'coins' },
  { key: 'stocks', label: 'Stocks & ETFs', icon: 'trending-up' },
];

const HEADINGS: Record<TabKey, { title: string; subtitle: string }> = {
  leaderboards: {
    title: 'Cryptocurrency Leaderboards',
    subtitle: 'Top cryptocurrencies ranked by market capitalization',
  },
  gainerslosers: {
    title: 'Top Crypto Gainers and Losers',
    subtitle: 'Discover the top cryptocurrency gainers and losers — data from CoinMarketCap',
  },
  trending: {
    title: 'Trending Cryptocurrencies',
    subtitle: 'The most searched and trending cryptocurrencies on CoinMarketCap',
  },
  mostvisited: {
    title: 'Most Visited Cryptocurrencies',
    subtitle: 'The most viewed cryptocurrency pages on CoinMarketCap',
  },
  recentlyadded: {
    title: 'Recently Added Cryptocurrencies',
    subtitle: 'The latest cryptocurrencies added to CoinMarketCap',
  },
  sentiment: {
    title: 'Community Sentiment',
    subtitle: 'Cryptocurrencies with the highest community activity and trading interest',
  },
  metals: {
    title: 'Precious Metals',
    subtitle: 'Gold, silver, platinum and palladium futures, ranked by daily move — via Yahoo Finance',
  },
  stocks: {
    title: 'Stocks & ETFs',
    subtitle: 'Major equities and index ETFs, ranked by daily move — via Yahoo Finance',
  },
};

const TIMEFRAMES: { key: string; label: string; changeKey: ChangeKey }[] = [
  { key: '1h', label: '1h', changeKey: 'change1h' },
  { key: '24h', label: '24h', changeKey: 'change24h' },
  { key: '7d', label: '7d', changeKey: 'change7d' },
  { key: '30d', label: '30d', changeKey: 'change30d' },
];

const COIN_POOLS: { key: number; label: string }[] = [
  { key: 100, label: 'Top 100' },
  { key: 500, label: 'Top 500' },
  { key: 0, label: 'All' },
];

const REFRESH_MS = 30_000;
/** "All" still needs a concrete request size; the route clamps to 1000 anyway. */
const ALL_POOL_LIMIT = 1000;
/** Reach drops illiquid coins before ranking — without it the boards fill with dead microcaps. */
const MIN_VOLUME = 50_000;

/* ── Formatters (ported verbatim from Reach) ── */

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

const fgColor = (v: number) => (v >= 50 ? '#16c784' : v >= 25 ? '#f5c518' : '#ea3943');

function ChangePill({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="gl-change-pill">—</span>;
  const pos = pct >= 0;
  return (
    <span className={'gl-change-pill ' + (pos ? 'positive' : 'negative')}>
      <Icon name={pos ? 'trending-up' : 'trending-down'} size={11} />
      {pos ? '+' : ''}
      {pct.toFixed(2)}%
    </span>
  );
}

export default function MoversView() {
  const [tab, setTab] = useState<TabKey>('gainerslosers');
  const [coins, setCoins] = useState<Coin[]>([]);
  const [trending, setTrending] = useState<Coin[]>([]);
  const [mostVisited, setMostVisited] = useState<Coin[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Coin[]>([]);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [rows, setRows] = useState<MoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [timeframe, setTimeframe] = useState('24h');
  const [coinPool, setCoinPool] = useState(100);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'desc',
  });

  const changeKey: ChangeKey =
    TIMEFRAMES.find((t) => t.key === timeframe)?.changeKey ?? 'change24h';
  const tfLabel = TIMEFRAMES.find((t) => t.key === timeframe)?.label ?? '24h';

  const fetchData = useCallback(async () => {
    setLoading(true);
    const limit = coinPool === 0 ? ALL_POOL_LIMIT : coinPool;
    try {
      const [cmcRes, moversRes] = await Promise.all([
        fetch(`/api/market/cmc?limit=${limit}`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/market/movers').then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cmcRes) {
        setCoins(cmcRes.coins ?? []);
        setTrending(cmcRes.trending ?? []);
        setMostVisited(cmcRes.mostVisited ?? []);
        setRecentlyAdded(cmcRes.recentlyAdded ?? []);
        setFearGreed(cmcRes.fearGreed ?? null);
      }
      if (moversRes) setRows(moversRes.rows ?? []);
      setUpdatedAt(new Date());
    } catch {
      // Leave the previous data on screen — a transient blip shouldn't blank the page.
    } finally {
      setLoading(false);
    }
  }, [coinPool]);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // A sort column from one tab rarely means anything on the next (and the GL tab's change column is
  // timeframe-dependent), so reset it on switch — as Reach does.
  useEffect(() => {
    setSort({ key: null, dir: 'desc' });
  }, [tab]);

  const handleSort = (key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortList = useCallback(
    <T extends Coin | MoverRow>(list: T[]): T[] => {
      if (!sort.key) return list;
      const k = sort.key;
      // Not every sort key exists on every row type (MoverRow has no marketCap, for instance) —
      // a missing or null field sorts as 0 rather than throwing.
      const val = (row: T): number => {
        const v = (row as unknown as Record<string, unknown>)[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      };
      return [...list].sort((a, b) => (sort.dir === 'asc' ? val(a) - val(b) : val(b) - val(a)));
    },
    [sort],
  );

  /* ── Derived lists ── */

  // Illiquid coins are excluded from every ranking (Reach's `volume > 50000` gate).
  const liquid = useMemo(() => coins.filter((c) => (c.volume ?? 0) > MIN_VOLUME), [coins]);

  const { gainers, losers } = useMemo(() => {
    const pool =
      coinPool === 0 ? liquid : liquid.filter((c) => (c.cmcRank ?? Infinity) <= coinPool);
    const byChange = [...pool].sort((a, b) => (b[changeKey] ?? 0) - (a[changeKey] ?? 0));
    return {
      gainers: byChange.filter((c) => (c[changeKey] ?? 0) > 0).slice(0, 30),
      losers: byChange
        .filter((c) => (c[changeKey] ?? 0) < 0)
        .reverse()
        .slice(0, 30),
    };
  }, [liquid, coinPool, changeKey]);

  const leaderboards = useMemo(
    () => [...coins].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 30),
    [coins],
  );

  // Bullish/bearish rank by volume × change — a momentum score, so a big move on real volume
  // outranks a bigger move on none.
  const { bullish, bearish } = useMemo(() => {
    const score = (c: Coin) => (c.volume ?? 0) * (c.change24h ?? 0);
    return {
      bullish: liquid
        .filter((c) => (c.change24h ?? 0) > 0)
        .sort((a, b) => score(b) - score(a))
        .slice(0, 15),
      bearish: liquid
        .filter((c) => (c.change24h ?? 0) < 0)
        .sort((a, b) => score(a) - score(b))
        .slice(0, 15),
    };
  }, [liquid]);

  const metalRows = useMemo(() => rows.filter((r) => r.assetType === 'metal'), [rows]);
  const stockRows = useMemo(() => rows.filter((r) => r.assetType === 'stock'), [rows]);

  /* ── Table renderers ── */

  const sortableTh = (key: SortKey, label: string, cls: string) => (
    <th className={cls + ' gl-sortable'} onClick={() => handleSort(key)}>
      {label} <Icon name="arrow-up-down" size={10} />
    </th>
  );

  // Leaderboards / Trending / Most Visited / Recently Added.
  const renderCoinTable = (list: Coin[]) => {
    const sorted = sortList(list);
    return (
      <div className="gl-table-wrapper">
        <table className="gl-cmc-table">
          <thead>
            <tr>
              <th className="gl-th-rank">#</th>
              <th className="gl-th-name">Name</th>
              {sortableTh('price', 'Price', 'gl-th-price')}
              {sortableTh('change24h', '24h %', 'gl-th-change')}
              {sortableTh('marketCap', 'Market Cap', 'gl-th-mcap')}
              {sortableTh('volume', 'Volume(24h)', 'gl-th-volume')}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="gl-td-empty" colSpan={6}>
                  {loading ? 'Loading…' : 'No data available'}
                </td>
              </tr>
            ) : (
              sorted.map((c, i) => (
                <tr key={c.id || c.symbol} className="gl-cmc-row">
                  <td className="gl-td-rank">{c.cmcRank ?? i + 1}</td>
                  <td className="gl-td-name">
                    <CoinIcon symbol={c.symbol} thumb={c.thumb} size={28} />
                    <span className="gl-coin-info">
                      <span className="gl-coin-name">{c.name}</span>
                      <span className="gl-coin-symbol">{c.symbol}</span>
                    </span>
                  </td>
                  <td className="gl-td-price">{fmtPrice(c.price)}</td>
                  <td className="gl-td-change">
                    <ChangePill pct={c.change24h} />
                  </td>
                  <td className="gl-td-mcap">{fmtMcap(c.marketCap)}</td>
                  <td className="gl-td-volume">{fmtVol(c.volume)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  // Gainers / Losers — no Market Cap column, and the % column follows the timeframe dropdown.
  const renderGLTable = (list: Coin[], kind: 'gainers' | 'losers') => {
    const sorted = sortList(list);
    return (
      <div className="gl-section-block">
        <div className={'gl-section-header ' + kind}>
          <Icon name={kind === 'gainers' ? 'trending-up' : 'trending-down'} size={16} />
          {kind === 'gainers' ? 'Top Gainers' : 'Top Losers'}
          <span className="gl-section-badge">{sorted.length}</span>
        </div>
        <div className="gl-table-wrapper">
          <table className="gl-cmc-table">
            <thead>
              <tr>
                <th className="gl-th-rank">#</th>
                <th className="gl-th-name">Name</th>
                {sortableTh('price', 'Price', 'gl-th-price')}
                {sortableTh(changeKey, `${tfLabel} %`, 'gl-th-change')}
                {sortableTh('volume', 'Volume(24h)', 'gl-th-volume')}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td className="gl-td-empty" colSpan={5}>
                    {loading ? 'Loading…' : 'No data available'}
                  </td>
                </tr>
              ) : (
                sorted.map((c) => (
                  <tr key={c.id || c.symbol} className="gl-cmc-row">
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
                      <ChangePill pct={c[changeKey]} />
                    </td>
                    <td className="gl-td-volume">{fmtVol(c.volume)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Community Sentiment. Unlike Reach, this sorts through `sortList` — see the note at the top.
  const renderSentimentTable = (list: Coin[], isBullish: boolean) => {
    const sorted = sortList(list);
    return (
      <div className="gl-section-block">
        <div className={'gl-section-header ' + (isBullish ? 'gainers' : 'losers')}>
          <Icon name={isBullish ? 'trending-up' : 'trending-down'} size={16} />
          {isBullish ? 'Most Bullish' : 'Most Bearish'}
        </div>
        <div className="gl-table-wrapper">
          <table className="gl-cmc-table">
            <thead>
              <tr>
                <th className="gl-th-rank">#</th>
                <th className="gl-th-name">Name</th>
                {sortableTh('price', 'Price', 'gl-th-price')}
                {sortableTh('change24h', '24h %', 'gl-th-change')}
                {sortableTh('volume', 'Volume(24h)', 'gl-th-volume')}
                <th className="gl-th-sentiment">Sentiment</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td className="gl-td-empty" colSpan={6}>
                    {loading ? 'Loading…' : 'No data available'}
                  </td>
                </tr>
              ) : (
                sorted.map((c) => {
                  const pct = c.change24h ?? 0;
                  // Per-coin score, not a share of the list: a +25% move reads as 100% bullish.
                  const s = Math.min(100, Math.max(0, 50 + pct * 2));
                  const width = isBullish ? s : 100 - s;
                  return (
                    <tr key={c.id || c.symbol} className="gl-cmc-row">
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
                        <ChangePill pct={c.change24h} />
                      </td>
                      <td className="gl-td-volume">{fmtVol(c.volume)}</td>
                      <td className="gl-td-sentiment">
                        <div className="gl-sentiment-bar">
                          <div
                            className="gl-sentiment-fill"
                            style={{
                              width: `${width}%`,
                              background: isBullish ? '#16c784' : '#ea3943',
                            }}
                          />
                        </div>
                        <span className={isBullish ? 'gl-bullish-text' : 'gl-bearish-text'}>
                          {width.toFixed(0)}% {isBullish ? 'Bullish' : 'Bearish'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Metals / Stocks — our own tabs, off /api/market/movers.
  const renderMoverTable = (list: MoverRow[], kind: 'metal' | 'stock') => {
    const sorted = sortList(list);
    return (
      <div className="gl-table-wrapper">
        <table className="gl-cmc-table">
          <thead>
            <tr>
              <th className="gl-th-name">Name</th>
              {sortableTh('price', 'Price', 'gl-th-price')}
              {sortableTh('change24h', '24h %', 'gl-th-change')}
              {sortableTh('volume', 'Volume(24h)', 'gl-th-volume')}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="gl-td-empty" colSpan={4}>
                  {loading ? 'Loading…' : 'No data available'}
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.symbol} className="gl-cmc-row">
                  <td className="gl-td-name">
                    {kind === 'metal' ? (
                      <AssetIcon symbol={r.symbol} assetType="metal" size={28} />
                    ) : (
                      <AssetIcon symbol={r.symbol} assetType="stock" size={28} />
                    )}
                    <span className="gl-coin-info">
                      <span className="gl-coin-name">{r.name}</span>
                      <span className="gl-coin-symbol">{r.symbol}</span>
                    </span>
                  </td>
                  <td className="gl-td-price">{fmtPrice(r.price)}</td>
                  <td className="gl-td-change">
                    <ChangePill pct={r.change24h} />
                  </td>
                  <td className="gl-td-volume">{fmtVol(r.volume)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const heading = HEADINGS[tab];
  const isGL = tab === 'gainerslosers';

  return (
    <div className="gl-page">
      <nav className="gl-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={'gl-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="gl-page-header">
        <h1 className="gl-page-title">{heading.title}</h1>
        <p className="gl-page-subtitle">{heading.subtitle}</p>
      </div>

      <div className="gl-controls">
        <div className="gl-controls-left">
          {isGL && (
            <>
              <select
                className="gl-select"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                aria-label="Timeframe"
              >
                {TIMEFRAMES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                className="gl-select"
                value={coinPool}
                onChange={(e) => setCoinPool(Number(e.target.value))}
                aria-label="Coin pool"
              >
                {COIN_POOLS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <button className="gl-refresh-btn" onClick={() => void fetchData()} disabled={loading}>
          <Icon name="refresh-cw" size={14} className={loading ? 'spinning' : undefined} />
          {updatedAt && <span className="gl-updated">{updatedAt.toLocaleTimeString()}</span>}
        </button>
      </div>

      {tab === 'leaderboards' && renderCoinTable(leaderboards)}
      {tab === 'trending' && renderCoinTable(trending)}
      {tab === 'mostvisited' && renderCoinTable(mostVisited)}
      {tab === 'recentlyadded' && renderCoinTable(recentlyAdded)}

      {isGL && (
        <div className="gl-sections">
          {renderGLTable(gainers, 'gainers')}
          {renderGLTable(losers, 'losers')}
        </div>
      )}

      {tab === 'sentiment' && (
        <>
          {fearGreed && (
            <div className="gl-fg-card">
              <div className="gl-fg-label">Market Sentiment</div>
              <div className="gl-fg-value" style={{ color: fgColor(fearGreed.value) }}>
                {fearGreed.value} — {fearGreed.classification}
              </div>
              <div className="gl-fg-bar">
                <div
                  className="gl-fg-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, fearGreed.value))}%`,
                    background: fgColor(fearGreed.value),
                  }}
                />
              </div>
              <div className="gl-fg-labels">
                <span>Extreme Fear</span>
                <span>Neutral</span>
                <span>Extreme Greed</span>
              </div>
            </div>
          )}
          <div className="gl-sections">
            {renderSentimentTable(bullish, true)}
            {renderSentimentTable(bearish, false)}
          </div>
        </>
      )}

      {tab === 'metals' && renderMoverTable(metalRows, 'metal')}
      {tab === 'stocks' && renderMoverTable(stockRows, 'stock')}

      <p className="gl-page-disclaimer">
        Crypto data from CoinMarketCap; metals and equities from Yahoo Finance. Prices refresh every
        30 seconds and may be delayed. Not investment advice.
      </p>
    </div>
  );
}
