'use client';

import React, { useEffect, useMemo, useState } from 'react';
import CoinIcon from './CoinIcon';
import MarketIcon from './MarketIcon';
import { Icon } from './icons';
import type { MarketClass } from './marketIcons';

// The page a leaderboard row opens into. Every asset class lands here — crypto, stocks, ETFs,
// commodities — because /api/market/asset normalises all four onto one payload: a header quote, a
// price series, a list of stats, a description, and a markets panel.
//
// The stats grid is deliberately data-driven rather than hardcoded per class: the route decides
// which tiles exist for a given asset and this renders exactly those, in order. A commodity has no
// market cap and no sector, so those tiles simply never arrive — nothing is faked to square the grid.
//
// The markets panel resolves to one of three things, and which one is a statement about what data
// honestly exists (see the route's ./tokenized):
//
//   crypto             a real CEX/DEX market-pairs table — the coin IS the traded instrument.
//   tokenized proxy    the same table, but for a *token* standing in for the asset (gold → XAUt).
//                      Real pairs, different instrument, so it renders a loud disclosure and sits
//                      BELOW where-to-buy rather than replacing it.
//   everything else    where-to-buy: the one real listing venue plus a generic broker list. These
//                      assets have no per-venue market to tabulate, and inventing one is the whole
//                      failure mode this shape exists to avoid.

/** Mirrors the route's `AssetClass`. */
export type DetailClass = 'crypto' | 'stocks' | 'etfs' | 'commodities';

/** What the row that was clicked knows about itself — enough to fetch the rest. */
export interface AssetRef {
  cls: DetailClass;
  /** CMC's numeric coin id. Crypto only; the other classes key off the ticker. */
  id?: number;
  symbol: string;
  name: string;
  /** CMC logo URL for crypto rows; the others resolve an icon from the ticker. */
  thumb?: string;
}

type Range = '24H' | '7D' | '1M' | '1Y' | 'ALL';

const RANGES: Range[] = ['24H', '7D', '1M', '1Y', 'ALL'];

interface Stat {
  label: string;
  value: number | null;
  kind: 'usd' | 'big' | 'pct' | 'num' | 'text';
  text?: string;
}

/** A venue trading the asset. Crypto only — see `WhereToBuy`. */
interface MarketPair {
  exchange: string;
  /** CMC's exchange id, which keys its logo CDN. Null when the pair arrives without one. */
  exchangeId: number | null;
  pair: string;
  price: number | null;
  depthPlus: number | null;
  depthMinus: number | null;
  volume: number | null;
  volumePct: number | null;
  type: string;
  url: string;
}

/**
 * The non-crypto answer to "where can I buy this". Stocks, ETFs and commodities have no market-pairs
 * table — one listing venue, and every broker fills against the same consolidated quote — so this is
 * the listing venue (real) plus the brokers that carry the class (a generic list, labelled as such).
 */
interface WhereToBuy {
  venue: string | null;
  currency: string | null;
  brokers: { label: string; url: string }[];
}

/**
 * A commodity's tokenized stand-in and the venues trading *it* — gold via XAUt today.
 *
 * This is the one case where a non-crypto asset has a real CEX/DEX table. The rows are genuine CMC
 * market pairs, but they describe the token, not the futures contract the rest of the page is
 * about, so the panel leads with a disclosure saying exactly that.
 */
interface Tokenized {
  token: string;
  tokenName: string;
  /** What one token is redeemable for — the sentence that makes the substitution legible. */
  backing: string;
  pairs: MarketPair[];
  total: number;
}

interface Detail {
  cls: DetailClass;
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  rank: number | null;
  stats: Stat[];
  description: string;
  links: { label: string; url: string }[];
  chart: [number, number][];
  range: Range;
  markets: MarketPair[];
  marketCount: number;
  marketPageSize: number;
  whereToBuy: WhereToBuy | null;
  tokenized: Tokenized | null;
}

/* ── Formatters. Same rules as the leaderboard's, so a price reads identically on both screens. ── */

const fmtUsd = (p: number | null): string => {
  if (p == null) return '—';
  if (p < 0.001) return `$${p.toFixed(8)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  if (p < 100) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const fmtBig = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

/** Bare counts (supply, share volume) — no dollar sign, since these aren't money. */
const fmtNum = (v: number | null): string => {
  if (v == null) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const fmtStat = (s: Stat): string => {
  if (s.kind === 'text') return s.text || '—';
  if (s.value == null) return '—';
  if (s.kind === 'usd') return fmtUsd(s.value);
  if (s.kind === 'big') return fmtBig(s.value);
  if (s.kind === 'pct') return `${s.value.toFixed(2)}%`;
  return fmtNum(s.value);
};

/** Timestamp formatter for the chart's x-axis, coarsened by how much time the window spans. */
const axisLabel = (unixSec: number, range: Range): string => {
  const d = new Date(unixSec * 1000);
  if (range === '24H') return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (range === '7D') return d.toLocaleDateString([], { weekday: 'short' });
  if (range === 'ALL') return String(d.getFullYear());
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/* ── Price chart ────────────────────────────────────────────────────────────────────────────────
 *
 * An inline SVG line rather than a charting library: this is one series with no interaction beyond a
 * hover readout, and pulling in a chart package for it would cost more bundle than the whole wallet.
 *
 * It draws in a fixed 0..W × 0..H user space and scales to the container with a viewBox, so the
 * component needs no resize observer and no layout measurement — the browser handles the stretch.
 */

const W = 1000;
const H = 260;
/** Room for the y-axis labels on the right and the x-axis labels underneath. */
const PAD_R = 8;
const PAD_B = 22;
const PAD_T = 10;

function PriceChart({ points, range }: { points: [number, number][]; range: Range }) {
  // Index of the point under the cursor, or null when not hovering.
  const [hover, setHover] = useState<number | null>(null);

  // The line is coloured by the performance of the window on screen, NOT by the header's 24h change.
  // Those disagree constantly: Bitcoin can be down 2% on the day inside a decade that is up
  // 100,000,000%, and painting that ALL-range chart red would contradict the line it is drawing.
  const up = points.length < 2 || points[points.length - 1][1] >= points[0][1];

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const lo = Math.min(...points.map((p) => p[1]));
    const hi = Math.max(...points.map((p) => p[1]));
    // A dead-flat series (a stablecoin at $1.00) has zero span, which would divide by zero and put
    // every y at NaN. Give it a nominal span so the line renders down the middle.
    const span = hi - lo || Math.abs(hi) * 0.01 || 1;
    const plotH = H - PAD_T - PAD_B;
    const plotW = W - PAD_R;

    const x = (i: number) => (i / (points.length - 1)) * plotW;
    const y = (v: number) => PAD_T + plotH - ((v - lo) / span) * plotH;

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p[1]).toFixed(2)}`).join('');
    // The fill is the same path closed down to the baseline — one shape, no second pass over data.
    const area = `${line}L${x(points.length - 1).toFixed(2)},${H - PAD_B}L0,${H - PAD_B}Z`;

    return { lo, hi, x, y, line, area, plotW };
  }, [points]);

  if (!geom) {
    return <div className="ad-chart-empty">No price history available</div>;
  }

  const { lo, hi, x, y, line, area, plotW } = geom;
  const stroke = up ? 'var(--green, #16c784)' : 'var(--red, #ea3943)';
  const gradId = up ? 'ad-grad-up' : 'ad-grad-down';

  // Four evenly spaced ticks along the x-axis (five including the origin), enough to orient without
  // crowding a 1000-unit-wide canvas.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (points.length - 1)));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Client px → user-space x → nearest sample. The chart is uniformly sampled, so this is exact.
    const ux = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round((ux / plotW) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hp = hover != null ? points[hover] : null;

  // The hovered point in *percent of the plot box*, which is the coordinate system the DOM overlay
  // lives in. Percent survives the viewBox's non-uniform scale; SVG user units do not.
  const pctX = hp ? `${(x(hover!) / W) * 100}%` : '0%';
  const pctY = hp ? `${(y(hp[1]) / H) * 100}%` : '0%';

  // The tooltip sits beside the cursor, and flips to its left half of the way across so it can't run
  // off the right edge of the card.
  const flip = hp != null && x(hover!) / W > 0.5;

  // Whether a time-of-day is meaningful, decided by the data's actual sampling step rather than the
  // range label — the two don't agree across classes. Yahoo's 1M is daily bars (every point would
  // read "12:00 AM"), while CMC hands back ~700 intraday points for the same 1M window, which do
  // carry a real time. Anything sampled finer than a day gets a clock.
  const intraday =
    points.length > 1 && points[1][0] - points[0][0] < 86_400;

  return (
    <div className="ad-chart">
      {/* The SVG and the hover overlay share this box, so the overlay's percent coordinates resolve
          against exactly the area the viewBox drew into — not against the card, whose asymmetric
          padding (room for the y-axis labels) would shift every point sideways. */}
      <div className="ad-chart-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="ad-chart-svg"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Price chart, ${range}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal guides at the low, mid and high of the series. */}
          {[lo, (lo + hi) / 2, hi].map((v, i) => (
            <line
              key={i}
              x1="0"
              x2={W}
              y1={y(v)}
              y2={y(v)}
              className="ad-chart-grid"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            /* Without this the horizontal stretch of the viewBox would smear the stroke width. */
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* The whole hover layer — crosshair, dot and tooltip — is DOM positioned in percent, NOT
            SVG. `preserveAspectRatio="none"` scales the viewBox non-uniformly (the 1000-unit width
            stretches to the container, the 260-unit height does not), so a <circle> inside it
            renders as a squashed ellipse — and `vectorEffect` can't save it, that only spares the
            stroke, never the geometry. Percent-positioned DOM sits above the stretch and stays
            perfectly round. It's also `pointer-events: none`, so it can't steal the SVG's hover. */}
        {hp && <div className="ad-chart-cursor" style={{ left: pctX }} />}
        {hp && (
          <div className="ad-chart-dot" style={{ left: pctX, top: pctY, background: stroke }} />
        )}

        {/* Follows the cursor rather than sitting in a fixed corner, and flips to the cursor's left
            past the halfway mark so it can never overflow the card's right edge. */}
        {hp && (
          <div className={'ad-chart-tip' + (flip ? ' flip' : '')} style={{ left: pctX, top: pctY }}>
            <div className="ad-tip-head">
              <span>{new Date(hp[0] * 1000).toLocaleDateString()}</span>
              {/* Only the intraday windows carry a meaningful time. 1M/1Y/ALL are daily or monthly
                  bars, where every point would read "12:00 AM" — noise, not information. */}
              {intraday && (
                <span className="ad-tip-time">
                  {new Date(hp[0] * 1000).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
            <div className="ad-tip-row">
              <span className="ad-tip-swatch" style={{ background: stroke }} />
              <span className="ad-tip-label">Price:</span>
              <strong className="ad-tip-value">{fmtUsd(hp[1])}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Axis labels sit outside the SVG: inside a non-uniformly-scaled viewBox the text would be
          stretched horizontally along with the geometry. */}
      <div className="ad-chart-yaxis">
        <span>{fmtUsd(hi)}</span>
        <span>{fmtUsd((lo + hi) / 2)}</span>
        <span>{fmtUsd(lo)}</span>
      </div>
      <div className="ad-chart-xaxis">
        {ticks.map((i) => (
          <span key={i}>{axisLabel(points[i][0], range)}</span>
        ))}
      </div>

    </div>
  );
}

/* ── Markets (crypto) ────────────────────────────────────────────────────────────────────────────
 *
 * The venues actually trading the coin, ranked by CMC's liquidity-aware order. Every row deep-links
 * into that exchange's trade screen, which is the whole point of the panel: "where can I buy this".
 */

/**
 * The exchange's logo, off CMC's CDN — the same host that already serves the coin icons, so it costs
 * no new origin. A pair can arrive without an `exchangeId`, and a CDN entry can 404, so both fall
 * back to the venue's initial rather than leaving a broken-image glyph in the row.
 */
function ExchangeIcon({ id, name }: { id: number | null; name: string }) {
  const [broken, setBroken] = useState(false);

  if (id == null || broken) {
    return <span className="ad-exch-fallback">{name.charAt(0).toUpperCase()}</span>;
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- remote logo CDN; next/image would need
       the host allow-listed and buys nothing for a 20px avatar. Same call MarketIcon already makes. */
    <img
      className="ad-exch-logo"
      src={`https://s2.coinmarketcap.com/static/img/exchanges/64x64/${id}.png`}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

type MktFilter = 'all' | 'cex' | 'dex';

const MKT_FILTERS: { key: MktFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'cex', label: 'CEX' },
  { key: 'dex', label: 'DEX' },
];

/**
 * Sortable columns of the markets table. Every one maps to a MarketPair field except `depth`, which
 * is the pair's two depth numbers summed — the column shows both, so the sort uses their total.
 * `#` is absent on purpose: it's a row counter, not data.
 */
type MktSortKey = 'exchange' | 'pair' | 'price' | 'depth' | 'volume' | 'volumePct';

/**
 * Page numbers to render, condensed with ellipses so 86 pages don't become 86 buttons.
 * Always shows first, last, current and its neighbours: 1 … 7 [8] 9 … 86.
 */
function pageList(current: number, last: number): (number | '…')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);

  const out: (number | '…')[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(last - 1, current + 1);

  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < last - 1) out.push('…');
  out.push(last);

  return out;
}

function Pager({
  page,
  lastPage,
  busy,
  onPage,
}: {
  page: number;
  lastPage: number;
  busy: boolean;
  onPage: (p: number) => void;
}) {
  if (lastPage <= 1) return null;

  return (
    <nav className="ad-pager" aria-label="Markets pages">
      <button
        className="ad-page-btn"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1 || busy}
        aria-label="Previous page"
      >
        <Icon name="chevron-left" size={13} />
      </button>

      {pageList(page, lastPage).map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="ad-page-gap">
            …
          </span>
        ) : (
          <button
            key={p}
            className={'ad-page-btn' + (p === page ? ' active' : '')}
            onClick={() => onPage(p)}
            disabled={busy}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ),
      )}

      <button
        className="ad-page-btn"
        onClick={() => onPage(page + 1)}
        disabled={page >= lastPage || busy}
        aria-label="Next page"
      >
        <Icon name="chevron-right" size={13} />
      </button>
    </nav>
  );
}

function MarketsTable({
  name,
  markets,
  total,
  page,
  pageSize,
  busy,
  onPage,
  filter,
  onFilter,
  disclosure,
  unit = 'pairs',
}: {
  name: string;
  markets: MarketPair[];
  total: number;
  page: number;
  pageSize: number;
  busy: boolean;
  onPage: (p: number) => void;
  filter: MktFilter;
  onFilter: (f: MktFilter) => void;
  /**
   * Rendered above the table when the rows describe something other than the asset in the page
   * header — i.e. the tokenized-proxy case. Crypto passes nothing, because there the coin in the
   * header *is* the thing being traded and no caveat is owed.
   */
  disclosure?: React.ReactNode;
  /** What a row counts. 'pairs' for a coin; the token's ticker when these are the token's markets. */
  unit?: string;
}) {
  // Sorting is per-page, exactly as on the Leaderboards: the server hands back one page of ~2,146
  // pairs, so a column sort reorders the rows you're looking at — it can't pull row 900 onto page 1.
  // `null` key = CMC's own liquidity-aware ordering, which is the honest default.
  const [sort, setSort] = useState<{ key: MktSortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'desc',
  });

  const handleSort = (key: MktSortKey) => {
    setSort((prev) => {
      // Text columns read best A→Z; the numbers read best biggest-first. Second click flips either.
      const firstDir: 'asc' | 'desc' = key === 'exchange' || key === 'pair' ? 'asc' : 'desc';
      if (prev.key !== key) return { key, dir: firstDir };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  const filtered = filter === 'all' ? markets : markets.filter((m) => m.type === filter);

  const rows = useMemo(() => {
    if (!sort.key) return filtered;
    const k = sort.key;
    const mul = sort.dir === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      if (k === 'exchange' || k === 'pair') {
        return a[k].localeCompare(b[k]) * mul;
      }
      // Depth has two numbers; sort on the pair's total 2% liquidity, which is what the column means.
      const val = (m: MarketPair): number | null =>
        k === 'depth'
          ? m.depthPlus == null && m.depthMinus == null
            ? null
            : (m.depthPlus ?? 0) + (m.depthMinus ?? 0)
          : m[k];

      // A null is "CMC won't vouch for this number", not zero — it must never outrank a real value,
      // so nulls sink to the bottom in BOTH directions rather than flipping to the top on a re-sort.
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * mul;
    });
  }, [filtered, sort]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  // Rank continues across pages — row 1 of page 3 is #21, not #1.
  const rankBase = (page - 1) * pageSize;

  const sortableTh = (key: MktSortKey, label: string, cls: string) => (
    <th
      className={cls + ' gl-sortable' + (sort.key === key ? ' ad-sorted' : '')}
      onClick={() => handleSort(key)}
      aria-sort={sort.key !== key ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending'}
    >
      {label} <Icon name="arrow-up-down" size={10} />
    </th>
  );

  return (
    <div className="ad-markets">
      <div className="ad-markets-head">
        <h2 className="ad-about-title">{name} Markets</h2>
        <div className="ad-ranges" role="tablist" aria-label="Market type">
          {MKT_FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              className={'gl-class-tab' + (filter === f.key ? ' active' : '')}
              onClick={() => onFilter(f.key)}
              aria-selected={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {disclosure}

      {/* Dimmed rather than unmounted while a page loads: swapping the table for a spinner would
          collapse the card's height and jump the page under the cursor. */}
      <div className={'gl-table-wrapper' + (busy ? ' ad-busy' : '')}>
        <table className="gl-cmc-table">
          <thead>
            <tr>
              {/* # is a row counter, not data — sorting it would mean nothing. */}
              <th className="gl-th-rank">#</th>
              {sortableTh('exchange', 'Exchange', 'ad-th-exch')}
              {sortableTh('pair', 'Pair', 'ad-th-pair')}
              {sortableTh('price', 'Price', 'gl-th-price')}
              {sortableTh('volume', 'Volume (24h)', 'gl-th-volume')}
              {sortableTh('depth', '+2% / -2% Depth', 'ad-th-depth')}
              {sortableTh('volumePct', 'Volume %', 'ad-th-volpct')}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="gl-td-empty" colSpan={7}>
                  No {filter.toUpperCase()} markets
                </td>
              </tr>
            ) : (
              rows.map((m, i) => (
                <tr key={`${m.exchange}-${m.pair}-${i}`} className="gl-cmc-row">
                  <td className="gl-td-rank">{rankBase + i + 1}</td>
                  <td className="ad-td-exch">
                    {/* Keyed by id so a recycled row can't inherit the previous venue's
                        failed-to-load state and render the wrong fallback letter. */}
                    <ExchangeIcon key={m.exchangeId ?? m.exchange} id={m.exchangeId} name={m.exchange} />
                    <span>{m.exchange}</span>
                  </td>
                  <td className="ad-td-pair">
                    {/* The pair IS the call to action — it links straight into the trade screen. */}
                    {m.url ? (
                      <a
                        className="ad-pair-link"
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                      >
                        {m.pair}
                        <Icon name="external-link" size={11} />
                      </a>
                    ) : (
                      m.pair
                    )}
                  </td>
                  <td className="gl-td-price">{fmtUsd(m.price)}</td>
                  <td className="gl-td-volume">{fmtBig(m.volume)}</td>
                  <td className="ad-td-depth">
                    {m.depthPlus == null && m.depthMinus == null ? (
                      '—'
                    ) : (
                      <span className="ad-depth-pill">
                        {fmtBig(m.depthPlus)} / {fmtBig(m.depthMinus)}
                      </span>
                    )}
                  </td>
                  {/* CMC excludes some pairs' volume as untrustworthy; those report no share, and a
                      dash is the honest rendering — not 0%, which would read as "no trading". */}
                  <td className="ad-td-volpct">
                    {m.volumePct == null ? '—' : `${m.volumePct.toFixed(2)}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ad-markets-foot">
        <p className="ad-markets-note">
          {total > 0 && (
            <>
              Showing {(rankBase + 1).toLocaleString()}–
              {(rankBase + markets.length).toLocaleString()} of {total.toLocaleString()} {unit},
              ranked by liquidity.
            </>
          )}
          {/* The CEX/DEX tabs filter the page in the browser, not the query — so say so, rather than
              letting "3 of 2,146" read as though only 3 DEX pairs exist in total. */}
          {filter !== 'all' && (
            <> Filtered to {filter.toUpperCase()} within this page.</>
          )}
        </p>

        <Pager page={page} lastPage={lastPage} busy={busy} onPage={onPage} />
      </div>
    </div>
  );
}

/* ── Where to buy (stocks / ETFs / commodities) ──────────────────────────────────────────────────
 *
 * Deliberately NOT a markets table. These assets trade on a single listing venue and every broker
 * fills against the same consolidated quote, so a per-venue price/depth/volume table would be
 * fabricated. The venue is real (Yahoo); the brokers are a generic per-class list, and the panel
 * says so rather than implying a per-symbol check nobody made.
 */
function WhereToBuyPanel({ symbol, where }: { symbol: string; where: WhereToBuy }) {
  return (
    <div className="ad-markets">
      <h2 className="ad-about-title">Where to buy {symbol}</h2>

      {where.venue && (
        <div className="ad-venue">
          <span className="ad-stat-label">Listed on</span>
          <span className="ad-venue-name">
            {where.venue}
            {where.currency && <span className="ad-venue-ccy"> · {where.currency}</span>}
          </span>
        </div>
      )}

      <div className="ad-links">
        {where.brokers.map((b) => (
          <a
            key={b.label}
            className="ad-link"
            href={b.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <Icon name="external-link" size={12} />
            {b.label}
          </a>
        ))}
      </div>

      <p className="ad-markets-note">
        {symbol} trades on one listing venue, so there is no per-exchange price table as there is for
        crypto. The brokers above are common venues for this asset class — not a per-symbol
        availability check, and not an endorsement. Confirm with your broker before trading.
      </p>
    </div>
  );
}

/* ── Page ── */

interface Props {
  asset: AssetRef;
  onBack: () => void;
}

export default function AssetDetailView({ asset, onBack }: Props) {
  const [range, setRange] = useState<Range>('7D');
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mktFilter, setMktFilter] = useState<MktFilter>('all');
  const [mktPage, setMktPage] = useState(1);

  const key = asset.cls === 'crypto' ? String(asset.id) : asset.symbol;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const params = new URLSearchParams({
      cls: asset.cls,
      range,
      name: asset.name,
      mktPage: String(mktPage),
    });
    if (asset.cls === 'crypto') params.set('id', String(asset.id ?? ''));
    else params.set('symbol', asset.symbol);

    fetch(`/api/market/asset?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad response'))))
      .then((d: Detail) => {
        if (cancelled) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        // Keep whatever's already rendered — switching range on a blip shouldn't blank the page.
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // A switch to a different asset (or range) must not be overwritten by the previous fetch landing
    // late.
    return () => {
      cancelled = true;
    };
  }, [asset.cls, asset.symbol, asset.name, asset.id, range, key, mktPage]);

  // Reset per-asset view state when the asset changes: shells are reused, so 'ALL' on Bitcoin — or a
  // DEX-only market filter, or page 40 of its markets — shouldn't silently carry over to the next
  // coin (page 40 may not even exist for a coin with three pairs).
  useEffect(() => {
    setRange('7D');
    setExpanded(false);
    setMktFilter('all');
    setMktPage(1);
  }, [key]);

  // Until the payload lands, the header renders from what the leaderboard row already knew — name,
  // symbol and icon — so the page never flashes an empty shell.
  const name = data?.name || asset.name;
  const symbol = data?.symbol || asset.symbol;
  const change = data?.change24h ?? null;
  const up = (change ?? 0) >= 0;

  // Long descriptions (Bitcoin's runs several thousand words) are clamped; only the first few
  // paragraphs are worth reading inline.
  const paragraphs = useMemo(
    () => (data?.description ?? '').split('\n\n').filter(Boolean),
    [data?.description],
  );
  const shown = expanded ? paragraphs : paragraphs.slice(0, 3);

  return (
    <div className="gl-page ad-page">
      <button className="ad-back" onClick={onBack}>
        <Icon name="chevron-left" size={14} />
        Back
      </button>

      <div className="ad-header">
        {asset.cls === 'crypto' ? (
          <CoinIcon symbol={symbol} thumb={asset.thumb ?? ''} size={44} />
        ) : (
          <MarketIcon symbol={symbol} cls={asset.cls as MarketClass} size={44} />
        )}
        <div className="ad-title">
          <div className="ad-name-row">
            <h1 className="ad-name">{name}</h1>
            <span className="ad-symbol">{symbol}</span>
            {data?.rank != null && <span className="ad-rank">#{data.rank}</span>}
          </div>
          <div className="ad-price-row">
            <span className="ad-price">{fmtUsd(data?.price ?? null)}</span>
            {change != null && (
              <span className={'gl-change-pill ' + (up ? 'positive' : 'negative')}>
                <Icon name={up ? 'trending-up' : 'trending-down'} size={11} />
                {up ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="ad-chart-head">
        <div className="ad-ranges" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              className={'gl-class-tab' + (range === r ? ' active' : '')}
              onClick={() => setRange(r)}
              aria-selected={range === r}
            >
              {r}
            </button>
          ))}
        </div>
        {loading && <span className="ad-loading">Loading…</span>}
      </div>

      {failed && !data ? (
        <div className="ad-chart-empty">Couldn’t load data for {symbol}. Try again shortly.</div>
      ) : (
        <PriceChart points={data?.chart ?? []} range={data?.range ?? range} />
      )}

      {data && data.stats.length > 0 && (
        <div className="ad-stats">
          {data.stats.map((s) => (
            <div className="ad-stat" key={s.label}>
              <span className="ad-stat-label">{s.label}</span>
              <span className="ad-stat-value">{fmtStat(s)}</span>
            </div>
          ))}
        </div>
      )}

      {data && data.links.length > 0 && (
        <div className="ad-links">
          {data.links.map((l) => (
            <a
              key={l.label}
              className="ad-link"
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="external-link" size={12} />
              {l.label}
            </a>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="ad-about">
          <h2 className="ad-about-title">About {name}</h2>
          {shown.map((p, i) => (
            <p key={i} className="ad-about-p">
              {p}
            </p>
          ))}
          {paragraphs.length > 3 && (
            <button className="ad-about-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}

      {/* Where you can actually buy it. Two different answers, because the two cases genuinely
          differ — crypto has a real per-venue market, the rest have one listing and a broker. */}
      {data && data.markets.length > 0 && (
        <MarketsTable
          name={name}
          markets={data.markets}
          total={data.marketCount}
          page={mktPage}
          pageSize={data.marketPageSize || 10}
          busy={loading}
          onPage={setMktPage}
          filter={mktFilter}
          onFilter={setMktFilter}
        />
      )}
      {data?.whereToBuy && <WhereToBuyPanel symbol={symbol} where={data.whereToBuy} />}

      {/* The tokenized proxy's markets — real CEX/DEX rows, but for a *different instrument* than
          the one above. It sits below Where-to-buy, not instead of it: the futures contract and the
          token are two ways to get the same exposure, and the page shouldn't imply you can reach
          the COMEX contract through Binance. The disclosure carries that distinction. */}
      {data?.tokenized && (
        <MarketsTable
          name={data.tokenized.tokenName}
          markets={data.tokenized.pairs}
          total={data.tokenized.total}
          page={mktPage}
          pageSize={data.marketPageSize || 10}
          busy={loading}
          onPage={setMktPage}
          filter={mktFilter}
          onFilter={setMktFilter}
          unit={`${data.tokenized.token} pairs`}
          disclosure={
            <p className="ad-token-note">
              <strong>{name}</strong> itself trades as a futures contract and has no crypto market.
              These are the venues trading{' '}
              <strong>
                {data.tokenized.tokenName} ({data.tokenized.token})
              </strong>
              , a token redeemable for {data.tokenized.backing} — a different instrument, with its
              own issuer and counterparty risk, whose price tracks {name} closely but is not the
              same thing as the contract charted above.
            </p>
          }
        />
      )}

      <p className="gl-page-disclaimer">
        Crypto data and market pairs from CoinMarketCap; equities, ETFs and commodities from Yahoo
        Finance and Nasdaq; commodity descriptions from Wikipedia. Prices may be delayed. Not
        investment advice.
      </p>
    </div>
  );
}
