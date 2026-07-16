'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AssetRef } from './AssetDetailView';
import GlobalStats from '../GlobalStats';
import CoinIcon from './CoinIcon';
import { getMovers, setMovers } from './dataCache';
import MarketIcon from './MarketIcon';
import { Icon } from './icons';

// Market page — ported from Reach's GainersLosers.jsx.
//
// Two boards live here, picked by the `mode` prop and reached from two separate sidebar entries:
// Leaderboards (crypto / stocks / ETFs / commodities, off /api/market/cmc + /api/market/screener)
// and the market tab row (Gainers & Losers, Trending, Most Visited, Recently Added, Community
// Sentiment — all crypto, all off /api/market/cmc; see that route for why it needs no API key).
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
  circulatingSupply: number | null;
  maxSupply: number | null;
  sparkline7d: number[];
  thumb: string;
}

interface FearGreed {
  value: number;
  classification: string;
}

/** A leaderboard row from /api/market/screener — stocks, ETFs or commodities. */
interface ScreenerRow {
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  marketCap: number | null;
  volume: number | null;
}

// Shapes of the two upstream responses, cached whole so a revisit paints instantly (see dataCache).
interface CmcResponse {
  coins?: Coin[];
  trending?: Coin[];
  mostVisited?: Coin[];
  recentlyAdded?: Coin[];
  fearGreed?: FearGreed | null;
}
interface ScreenerResponse {
  stocks?: ScreenerRow[];
  etfs?: ScreenerRow[];
  commodities?: ScreenerRow[];
}
const CACHE_CMC = 'cmc';
const CACHE_SCREENER = 'screener';

/**
 * One leaderboard row, whatever the asset class. Crypto rows are Coins; stocks/ETFs/commodities are
 * ScreenerRows widened to match, so a single table renderer serves all four.
 *
 * `cmcRank` carries the board position (for crypto it really is CMC's rank; for the rest it's the
 * row's index in the server-ranked list). `thumb` is empty for non-crypto — those fall back to the
 * lettered avatar rather than a CMC logo URL.
 */
interface LeaderRow {
  key: string;
  symbol: string;
  name: string;
  cmcRank: number | null;
  price: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  volume: number | null;
  circulatingSupply: number | null;
  maxSupply: number | null;
  sparkline7d: number[];
  thumb: string;
}

/** The four asset classes the Leaderboards tab can show. */
type AssetClass = 'crypto' | 'stocks' | 'etfs' | 'commodities';

const ASSET_CLASSES: { key: AssetClass; label: string; icon: string }[] = [
  { key: 'crypto', label: 'Crypto', icon: 'bitcoin' },
  { key: 'stocks', label: 'Stocks', icon: 'trending-up' },
  { key: 'etfs', label: 'ETFs', icon: 'layers' },
  { key: 'commodities', label: 'Commodities', icon: 'coins' },
];

/** Subtitle per class — the heading has to say what's actually ranked. */
const ASSET_SUBTITLES: Record<AssetClass, string> = {
  crypto: 'Top cryptocurrencies ranked by market capitalization',
  stocks: 'Top US-listed stocks ranked by market capitalization',
  etfs: 'Major ETFs ranked by trading volume',
  commodities: 'Commodity futures ranked by trading volume',
};

type TabKey =
  | 'leaderboards'
  | 'gainerslosers'
  | 'trending'
  | 'mostvisited'
  | 'recentlyadded'
  | 'sentiment';

type ChangeKey = 'change1h' | 'change24h' | 'change7d' | 'change30d';
type SortKey = 'cmcRank' | 'price' | 'volume' | 'marketCap' | 'circulatingSupply' | ChangeKey;

// The market tab row. Leaderboards is deliberately absent — it's a left-sidebar destination of its
// own now, so listing it here too would give it two competing entry points.
const MARKET_TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'gainerslosers', label: 'Gainers & Losers', icon: 'bar-chart' },
  { key: 'trending', label: 'Trending', icon: 'flame' },
  { key: 'mostvisited', label: 'Most Visited', icon: 'eye' },
  { key: 'recentlyadded', label: 'Recently Added', icon: 'clock' },
  { key: 'sentiment', label: 'Community Sentiment', icon: 'users' },
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

/** Leaderboards paginate 100 coins a page up to 500, so every fetch must return at least that many. */
const LEADERBOARD_PAGE_SIZE = 100;
const LEADERBOARD_MAX = 500;

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

/**
 * The size column means a different thing per class, so it says so rather than calling all three
 * "Market Cap". An ETF's size is its AUM; a futures contract has no market cap at all (no ownership
 * stake, so no share count to price) and carries notional value — open interest × price × contract
 * size — instead. All three are dollars, so the column still sorts and compares cleanly.
 */
const MCAP_LABEL: Record<AssetClass, string> = {
  crypto: 'Market Cap',
  stocks: 'Market Cap',
  etfs: 'AUM',
  commodities: 'Notional',
};

const fmtMcap = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

/** Whole-token supply count (no dollar sign) — B/M/K like volume, but a plain number. */
const fmtSupply = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const fgColor = (v: number) => (v >= 50 ? '#16c784' : v >= 25 ? '#f5c518' : '#ea3943');

/** Inline 7d price sparkline. Colored by net direction (last vs first), green up / red down. */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <span className="gl-spark-empty">—</span>;
  const w = 96;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(' ');
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="gl-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? '#16c784' : '#ea3943'}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Momentum-derived sentiment (same heuristic as the Community Sentiment tab): a +25% 24h move reads
 *  as fully bullish. No accurate keyless per-coin sentiment feed exists, so this is the honest signal. */
function SentimentCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="gl-sent-neutral">—</span>;
  const s = Math.min(100, Math.max(0, 50 + pct * 2));
  const bullish = s >= 50;
  const label = s >= 55 ? 'Bullish' : s <= 45 ? 'Bearish' : 'Neutral';
  const color = label === 'Neutral' ? 'var(--muted)' : bullish ? '#16c784' : '#ea3943';
  return (
    <div className="gl-sent-cell">
      <span className="gl-sent-label" style={{ color }}>{label}</span>
      <div className="gl-sent-bar">
        <div className="gl-sent-fill" style={{ width: `${s.toFixed(0)}%`, background: color }} />
      </div>
    </div>
  );
}

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

interface Props {
  /**
   * Which board this instance shows. Leaderboards is now its own left-sidebar item, so it renders
   * standalone (no tab row); every other tab renders the market tab row as before, minus
   * Leaderboards. Defaults to the market view.
   */
  mode?: 'market' | 'leaderboards';
  /**
   * Called when a row is clicked. The shell owns the detail view, so this only reports *which* asset
   * was picked — enough for /api/market/asset to fetch the rest (a numeric CMC id for crypto, a
   * ticker for everything else).
   */
  onSelect?: (asset: AssetRef) => void;
}

export default function MoversView({ mode = 'market', onSelect }: Props = {}) {
  const isLeaderboardsMode = mode === 'leaderboards';
  const [tab, setTab] = useState<TabKey>(
    isLeaderboardsMode ? 'leaderboards' : 'gainerslosers',
  );
  // Seed every fetched dataset from the session cache so a revisit (or a return from another folder
  // tab) paints the last data instantly instead of the empty "Loading…" table; the fetch effects
  // below refresh it. `cmc`/`screener` hold the last raw response blobs under one key each.
  const cachedCmc = getMovers<CmcResponse>(CACHE_CMC);
  const cachedScreener = getMovers<ScreenerResponse>(CACHE_SCREENER);
  const [coins, setCoins] = useState<Coin[]>(() => cachedCmc?.coins ?? []);
  const [trending, setTrending] = useState<Coin[]>(() => cachedCmc?.trending ?? []);
  const [mostVisited, setMostVisited] = useState<Coin[]>(() => cachedCmc?.mostVisited ?? []);
  const [recentlyAdded, setRecentlyAdded] = useState<Coin[]>(() => cachedCmc?.recentlyAdded ?? []);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(() => cachedCmc?.fearGreed ?? null);
  // Only show the initial loading state when there's nothing cached to show.
  const [loading, setLoading] = useState(!cachedCmc);
  // Spins the refresh button on an explicit user refresh only. Kept separate from `loading` so the
  // 30s background poll refreshes in place without flipping a populated table to "Loading…".
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Stocks / ETFs / commodities for the Leaderboards tab, off /api/market/screener.
  const [stocks, setStocks] = useState<ScreenerRow[]>(() => cachedScreener?.stocks ?? []);
  const [etfs, setEtfs] = useState<ScreenerRow[]>(() => cachedScreener?.etfs ?? []);
  const [commodities, setCommodities] = useState<ScreenerRow[]>(
    () => cachedScreener?.commodities ?? [],
  );

  const [timeframe, setTimeframe] = useState('24h');
  const [coinPool, setCoinPool] = useState(100);
  const [lbPage, setLbPage] = useState(1);
  const [assetClass, setAssetClass] = useState<AssetClass>('crypto');
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'desc',
  });

  const changeKey: ChangeKey =
    TIMEFRAMES.find((t) => t.key === timeframe)?.changeKey ?? 'change24h';
  const tfLabel = TIMEFRAMES.find((t) => t.key === timeframe)?.label ?? '24h';

  // The pool dropdown only gates Gainers & Losers; the leaderboard always needs its full 500, so
  // never request fewer than that. Derived here rather than inside fetchData so the fetch depends on
  // the request it actually makes: Top 100 and Top 500 both clamp to 500, so switching between them
  // reuses the coins already on screen (the pool is applied client-side below) instead of refetching
  // and restarting the refresh interval. Only "All" widens the request.
  const limit = Math.max(coinPool === 0 ? ALL_POOL_LIMIT : coinPool, LEADERBOARD_MAX);

  const fetchData = useCallback(async () => {
    try {
      const cmcRes: CmcResponse | null = await fetch(`/api/market/cmc?limit=${limit}`).then((r) =>
        r.ok ? r.json() : null,
      );
      if (cmcRes) {
        setCoins(cmcRes.coins ?? []);
        setTrending(cmcRes.trending ?? []);
        setMostVisited(cmcRes.mostVisited ?? []);
        setRecentlyAdded(cmcRes.recentlyAdded ?? []);
        setFearGreed(cmcRes.fearGreed ?? null);
        setMovers(CACHE_CMC, cmcRes);
      }
      setUpdatedAt(new Date());
    } catch {
      // Leave the previous data on screen — a transient blip shouldn't blank the page.
    } finally {
      // Only the very first load shows the loading state; the 30s background polls refresh in place
      // rather than flipping a populated table back to "Loading…".
      setLoading(false);
    }
  }, [limit]);

  // The screener (500 stocks + ETFs + commodities) only feeds the Leaderboards tab, so it's fetched
  // separately and only while that tab is open — the other seven tabs shouldn't pay for it. Kept out
  // of `fetchData` so switching tabs doesn't rebuild that callback and restart the refresh interval.
  const fetchScreener = useCallback(async () => {
    try {
      const res: ScreenerResponse | null = await fetch('/api/market/screener').then((r) =>
        r.ok ? r.json() : null,
      );
      if (!res) return;
      setStocks(res.stocks ?? []);
      setEtfs(res.etfs ?? []);
      setCommodities(res.commodities ?? []);
      setMovers(CACHE_SCREENER, res);
    } catch {
      // Same as above: keep whatever's already on screen.
    }
  }, []);

  useEffect(() => {
    if (tab !== 'leaderboards') return;
    void fetchScreener();
    const id = setInterval(() => void fetchScreener(), REFRESH_MS);
    return () => clearInterval(id);
  }, [tab, fetchScreener]);

  // Refetch whenever the requested size changes (only "All" widens it — see `limit`), then poll.
  // The size change is user-driven and the 1000-coin pass is the slowest one, so it spins the
  // refresh indicator; the interval's background passes stay silent and refresh in place.
  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    void fetchData().finally(() => {
      if (!cancelled) setRefreshing(false);
    });
    const id = setInterval(() => void fetchData(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fetchData]);

  // A sort column from one tab rarely means anything on the next (and the GL tab's change column is
  // timeframe-dependent), so reset it on switch — as Reach does.
  useEffect(() => {
    setSort({ key: null, dir: 'desc' });
  }, [tab]);

  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      // Rank reads best-first, so it opens ascending (#1 at the top); every other column opens
      // descending (biggest price / mover / cap first). A second click flips whichever it is.
      const firstDir: 'asc' | 'desc' = key === 'cmcRank' ? 'asc' : 'desc';
      if (prev.key !== key) return { key, dir: firstDir };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  const sortList = useCallback(
    <T extends Coin | LeaderRow>(list: T[]): T[] => {
      if (!sort.key) return list;
      const k = sort.key;
      // Not every sort key exists on every row type — a missing or null field sorts as 0 rather
      // than throwing. Rank is the exception: 0 would
      // float unranked coins to the top of an ascending sort, so they sink to the bottom instead.
      const missing = k === 'cmcRank' ? Infinity : 0;
      const val = (row: T): number => {
        const v = (row as unknown as Record<string, unknown>)[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : missing;
      };
      // Compare rather than subtract: two unranked rows are both Infinity, and Infinity - Infinity
      // is NaN, which makes the comparator inconsistent.
      const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
      return [...list].sort((a, b) =>
        sort.dir === 'asc' ? cmp(val(a), val(b)) : cmp(val(b), val(a)),
      );
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

  // Every asset class is normalised to one row shape so a single table, one sort and one paginator
  // serve all four. `cmcRank` doubles as the board position, which is what the # column prints.
  //
  // Crypto ranks by CMC's own rank, NOT by raw `marketCap`: CMC excludes stablecoins, wrapped assets
  // and LP tokens from its ranking, so a coin like USDY carries a top-100 market cap but a rank of
  // 200+. Sorting on market cap pulled those into page 1 while the # column still printed their real
  // rank, which is why 200-something numbers showed up there.
  //
  // The screener classes arrive already ranked from the server (stocks by market cap, ETFs and
  // commodities by volume — neither has a market cap to rank on), so their position is just an index.
  const leaderboardRanked = useMemo((): LeaderRow[] => {
    if (assetClass === 'crypto') {
      return [...coins]
        .sort((a, b) => (a.cmcRank ?? Infinity) - (b.cmcRank ?? Infinity))
        .slice(0, LEADERBOARD_MAX)
        .map((c) => ({ ...c, key: String(c.id || c.symbol) }));
    }
    const src =
      assetClass === 'stocks' ? stocks : assetClass === 'etfs' ? etfs : commodities;
    return src.slice(0, LEADERBOARD_MAX).map((r, i) => ({
      ...r,
      cmcRank: i + 1,
      change7d: null,
      circulatingSupply: null,
      maxSupply: null,
      sparkline7d: [],
      thumb: '',
      key: r.symbol,
    }));
  }, [assetClass, coins, stocks, etfs, commodities]);

  const lbPageCount = Math.max(1, Math.ceil(leaderboardRanked.length / LEADERBOARD_PAGE_SIZE));

  // A shrinking list (a smaller upstream response) can strand the page past the end.
  useEffect(() => {
    setLbPage((p) => Math.min(p, lbPageCount));
  }, [lbPageCount]);

  // Switching class swaps the whole board out, so the page you were on no longer refers to anything.
  useEffect(() => {
    setLbPage(1);
    setSort({ key: null, dir: 'desc' });
  }, [assetClass]);

  // Page first, sort second — a column sort only ever reorders the 100 rows you're looking at, and
  // never pulls a row in from another page. Which rows land on page N is fixed by board rank.
  const leaderboards = useMemo(() => {
    const start = (Math.min(lbPage, lbPageCount) - 1) * LEADERBOARD_PAGE_SIZE;
    return sortList(leaderboardRanked.slice(start, start + LEADERBOARD_PAGE_SIZE));
  }, [leaderboardRanked, lbPage, lbPageCount, sortList]);

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

  /* ── Table renderers ── */

  const sortableTh = (key: SortKey, label: string, cls: string) => (
    <th className={cls + ' gl-sortable'} onClick={() => handleSort(key)}>
      {label} <Icon name="arrow-up-down" size={10} />
    </th>
  );

  /**
   * Row-click plumbing, shared by every table on the page. A crypto row carries CMC's numeric `id`,
   * which is what the detail endpoint keys off; the screener classes have no id and key off the
   * ticker, so `id` is simply absent for them.
   *
   * Returned as props rather than a wrapper component so the <tr> keeps its place in the <tbody> —
   * an element between them is invalid table markup.
   */
  const rowProps = (row: Coin | LeaderRow, cls: AssetClass) => {
    if (!onSelect) return {};
    const asset: AssetRef = {
      cls,
      symbol: row.symbol,
      name: row.name,
      thumb: row.thumb,
      ...(cls === 'crypto' && 'id' in row ? { id: row.id } : {}),
    };
    const open = () => onSelect(asset);
    return {
      className: 'gl-cmc-row gl-cmc-row-link',
      onClick: open,
      // Keyboard parity: a clickable row that only responds to a mouse is unreachable by tab.
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      },
      role: 'button',
      tabIndex: 0,
    };
  };

  // Leaderboards (any asset class) / Trending / Most Visited / Recently Added.
  //
  // `preSorted` is for Leaderboards: the page has already been sliced and sorted upstream (sorting
  // is per-page, so it must happen after the slice) — re-sorting here would be redundant.
  //
  // `cls` picks the icon source. Crypto rows carry a CMC logo URL on the row itself (`thumb`); the
  // screener classes carry none, so they resolve one from the ticker instead (see MarketIcon). The
  // three crypto-only tabs never pass it, hence the default.
  const renderCoinTable = (
    list: (Coin | LeaderRow)[],
    opts?: { preSorted?: boolean; cls?: AssetClass },
  ) => {
    const sorted = opts?.preSorted ? list : sortList(list);
    const cls = opts?.cls ?? 'crypto';
    return (
      <div className="gl-table-wrapper">
        <table className="gl-cmc-table">
          <thead>
            <tr>
              {sortableTh('cmcRank', '#', 'gl-th-rank')}
              <th className="gl-th-name">Name</th>
              {sortableTh('price', 'Price', 'gl-th-price')}
              {sortableTh('change24h', '24h %', 'gl-th-change')}
              {sortableTh('marketCap', MCAP_LABEL[cls], 'gl-th-mcap')}
              {sortableTh('volume', 'Volume(24h)', 'gl-th-volume')}
              {cls === 'crypto' && (
                <>
                  {sortableTh('circulatingSupply', 'Circulating Supply', 'gl-th-supply')}
                  <th className="gl-th-sent">Sentiment</th>
                  <th className="gl-th-spark">7d Price%</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td className="gl-td-empty" colSpan={cls === 'crypto' ? 9 : 6}>
                  {loading ? 'Loading…' : 'No data available'}
                </td>
              </tr>
            ) : (
              sorted.map((c, i) => (
                <tr
                  key={'key' in c ? c.key : c.id || c.symbol}
                  className="gl-cmc-row"
                  {...rowProps(c, cls)}
                >
                  {/* The row's real board rank, not a row counter — a per-page sort reorders the
                      rows, and renumbering them 1..100 would misreport rank on every sorted view. */}
                  <td className="gl-td-rank">{c.cmcRank ?? i + 1}</td>
                  <td className="gl-td-name">
                    {cls === 'crypto' ? (
                      <CoinIcon symbol={c.symbol} thumb={c.thumb} size={28} />
                    ) : (
                      <MarketIcon symbol={c.symbol} cls={cls} size={28} />
                    )}
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
                  {cls === 'crypto' && (
                    <>
                      <td className="gl-td-supply">
                        <span className="gl-supply-val">
                          {fmtSupply(c.circulatingSupply)} {c.symbol}
                        </span>
                        {c.circulatingSupply != null && c.maxSupply != null && (
                          <div className="gl-supply-bar">
                            <div
                              className="gl-supply-fill"
                              style={{
                                width: `${Math.min(100, (c.circulatingSupply / c.maxSupply) * 100).toFixed(1)}%`,
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="gl-td-sent">
                        <SentimentCell pct={c.change24h} />
                      </td>
                      <td className="gl-td-spark">
                        <Sparkline data={c.sparkline7d} />
                      </td>
                    </>
                  )}
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
                  <tr key={c.id || c.symbol} className="gl-cmc-row" {...rowProps(c, 'crypto')}>
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
                    <tr key={c.id || c.symbol} className="gl-cmc-row" {...rowProps(c, 'crypto')}>
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

  const isLB = tab === 'leaderboards';
  const isGL = tab === 'gainerslosers';

  // On Leaderboards the heading follows the selected asset class, not the tab.
  const heading = isLB
    ? {
        title: `${ASSET_CLASSES.find((a) => a.key === assetClass)?.label ?? 'Crypto'} Leaderboards`,
        subtitle: ASSET_SUBTITLES[assetClass],
      }
    : HEADINGS[tab];

  return (
    <div className="gl-page">
      {/* Leaderboards is its own sidebar destination now, so it renders without the tab row — and
          the market tab row no longer carries it. */}
      {!isLeaderboardsMode && (
        <nav className="gl-tabs">
          {MARKET_TABS.map((t) => (
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
      )}

      <div className="gl-page-header">
        <h1 className="gl-page-title">{heading.title}</h1>
        <p className="gl-page-subtitle">{heading.subtitle}</p>
      </div>

      {isLB && (
        <div className="gl-class-tabs" role="tablist" aria-label="Asset class">
          {ASSET_CLASSES.map((a) => (
            <button
              key={a.key}
              role="tab"
              className={'gl-class-tab' + (assetClass === a.key ? ' active' : '')}
              onClick={() => setAssetClass(a.key)}
              aria-selected={assetClass === a.key}
            >
              <Icon name={a.icon} size={13} />
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className={'gl-controls' + (isLB ? ' gl-controls-lb' : '')}>
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
        <button
          className="gl-refresh-btn"
          onClick={() => {
            setRefreshing(true);
            // The screener isn't part of fetchData, so refresh it too when it's what's on screen.
            void Promise.all([fetchData(), isLB ? fetchScreener() : null]).finally(() =>
              setRefreshing(false),
            );
          }}
          disabled={loading || refreshing}
        >
          <Icon
            name="refresh-cw"
            size={14}
            className={loading || refreshing ? 'spinning' : undefined}
          />
          {updatedAt && <span className="gl-updated">{updatedAt.toLocaleTimeString()}</span>}
        </button>
      </div>

      {/* Market-snapshot cards (Market Cap / Fear & Greed / Altcoin Season) — crypto board only.
          Rendered after the controls row so the refresh button sits above the Altcoin Season card. */}
      {isLB && assetClass === 'crypto' && <GlobalStats />}

      {tab === 'leaderboards' && (
        <>
          {renderCoinTable(leaderboards, { preSorted: true, cls: assetClass })}
          {leaderboardRanked.length > LEADERBOARD_PAGE_SIZE && (
            <div className="gl-pagination">
              <span className="gl-pagination-range">
                {(lbPage - 1) * LEADERBOARD_PAGE_SIZE + 1}–
                {Math.min(lbPage * LEADERBOARD_PAGE_SIZE, leaderboardRanked.length)} of{' '}
                {leaderboardRanked.length}
              </span>
              <div className="gl-pagination-pages">
                <button
                  className="gl-page-btn"
                  onClick={() => setLbPage((p) => Math.max(1, p - 1))}
                  disabled={lbPage === 1}
                  aria-label="Previous page"
                >
                  <Icon name="chevron-left" size={14} />
                </button>
                {Array.from({ length: lbPageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    className={'gl-page-btn' + (p === lbPage ? ' active' : '')}
                    onClick={() => setLbPage(p)}
                    aria-current={p === lbPage ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ))}
                <button
                  className="gl-page-btn"
                  onClick={() => setLbPage((p) => Math.min(lbPageCount, p + 1))}
                  disabled={lbPage === lbPageCount}
                  aria-label="Next page"
                >
                  <Icon name="chevron-right" size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
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

      <p className="gl-page-disclaimer">
        Crypto data from CoinMarketCap; metals and equities from Yahoo Finance. Prices refresh every
        30 seconds and may be delayed. Not investment advice.
      </p>
    </div>
  );
}
