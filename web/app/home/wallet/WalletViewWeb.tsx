'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddAssetModal from './AddAssetModal';
import AssetIcon from './AssetIcon';
import { type AssetType, fmtPrice, fmtUsd, getAssetColor } from './assets';
import { getMarketPrices, setMarketPrices } from './dataCache';
import {
  addHolding,
  deleteHolding as removeHolding,
  type Holding,
  loadHoldings,
  loadSnapshots,
  recordSnapshot,
  type Snapshot,
  updateHolding,
} from './holdings';
import { Icon } from './icons';

// Portfolio view — ported from Reach's WalletView.jsx.
//
// Both charts are hand-rolled inline SVG, as in Reach: no charting library is pulled in for a
// sparkline and a donut. Prices come from our own /api/market/prices route (Reach reaches them
// through Electron IPC, which has no web equivalent).
//
// Not ported: Reach's drag-to-reorder stat cards and swap-charts gestures — extra state and
// localStorage keys for a rearrangement nobody asked for.

interface Quote {
  price: number;
  change24h: number;
}
type PriceMap = Record<string, Quote | null>;

const POLL_MS = 30_000;

// Must match .wallet-history-chart's height in globals.css — used as the pre-measurement fallback.
const CHART_H = 220;

const HISTORY_PERIODS: { label: string; hours: number | null }[] = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
  { label: '90d', hours: 2160 },
  { label: 'All', hours: null },
];

// ── History chart ──

function PortfolioHistory({
  snapshots,
  liveValue,
}: {
  snapshots: Snapshot[];
  liveValue: number;
}) {
  const [period, setPeriod] = useState(HISTORY_PERIODS[0]);

  // The SVG is drawn at the container's true pixel size (1 user unit = 1 CSS px) rather than being
  // scaled from a fixed viewBox — a fixed 400×200 box stretched to fill a ~900×220 container scales
  // x and y by different factors, which distorts and blurs the axis text. Measured here so the
  // geometry can be recomputed on resize.
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: CHART_H });
  // Index of the snapshot nearest the cursor; null when the pointer is away.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) || CHART_H });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const cutoff = period.hours ? Date.now() - period.hours * 3600_000 : 0;
    const inRange = snapshots.filter((s) => s.t >= cutoff);
    // Append the live value so the line always reaches "now" instead of stopping at the last
    // 5-minute snapshot.
    return liveValue > 0 ? [...inRange, { t: Date.now(), value: liveValue }] : inRange;
  }, [snapshots, liveValue, period]);

  const chart = useMemo(() => {
    // Width is 0 until the ResizeObserver reports; skip the geometry until then.
    if (data.length < 2 || size.w === 0) return null;

    const W = size.w;
    const H = size.h;
    const pad = { top: 10, right: 16, bottom: 28, left: 60 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const values = data.map((d) => d.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    // A dead-flat series has no range to scale against — pad it so the line lands mid-box.
    if (min === max) {
      min = min * 0.995;
      max = max * 1.005 || 1;
    }

    const t0 = data[0].t;
    const tSpan = data[data.length - 1].t - t0 || 1;
    const x = (t: number) => pad.left + ((t - t0) / tSpan) * innerW;
    const y = (v: number) => pad.top + (1 - (v - min) / (max - min)) * innerH;

    const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.t)},${y(d.value)}`).join(' ');
    const area = `${line} L${x(data[data.length - 1].t)},${pad.top + innerH} L${x(t0)},${pad.top + innerH} Z`;

    const up = values[values.length - 1] >= values[0];
    const color = up ? '#22c55e' : '#ef4444';

    // Decimals scale with the axis span, not the magnitude: a $62,700–$62,800 range at one decimal
    // renders five ticks that all read "$62.8K". Enough digits are kept to separate adjacent ticks.
    const span = max - min;
    const digitsFor = (unit: number) => {
      const step = span / 4 / unit;
      if (step <= 0) return 1;
      return Math.min(3, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
    };
    const fmtAxis = (v: number) => {
      if (v >= 1e6) return `$${(v / 1e6).toFixed(digitsFor(1e6))}M`;
      if (v >= 1e3) {
        const d = digitsFor(1e3);
        // "$62.700K" is a worse way to write "$62,700" — past 2 decimals, drop the K suffix.
        if (d > 2) return `$${Math.round(v).toLocaleString()}`;
        return `$${(v / 1e3).toFixed(d)}K`;
      }
      return `$${v.toFixed(span < 5 ? 2 : 0)}`;
    };

    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = min + ((max - min) * i) / 4;
      return { v, y: y(v), label: fmtAxis(v) };
    });

    const hours = period.hours;
    const fmtTime = (t: number) => {
      const d = new Date(t);
      if (hours && hours <= 24) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      }
      if (hours && hours <= 720) {
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
      return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
    };

    const xTicks = Array.from({ length: 5 }, (_, i) => {
      const t = t0 + (tSpan * i) / 4;
      return { x: x(t), label: fmtTime(t) };
    });

    // Screen positions for each snapshot, so the hover layer can hit-test without redoing the scales.
    const points = data.map((d) => ({ x: x(d.t), y: y(d.value), t: d.t, value: d.value }));

    return { W, H, pad, innerW, innerH, line, area, color, yTicks, xTicks, points };
  }, [data, period, size]);

  // Snap to the nearest point by x. The SVG is drawn at true pixel size, so client px map straight
  // onto chart units — no viewBox transform to undo.
  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!chart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < chart.points.length; i++) {
      const d = Math.abs(chart.points[i].x - px);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    setHoverIdx(nearest);
  };

  const hovered = chart && hoverIdx !== null ? chart.points[hoverIdx] : null;

  // Full date + time; the axis labels are deliberately terse and ambiguous up close.
  const fmtStamp = (t: number) =>
    new Date(t).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div className="wallet-history-card">
      <div className="wallet-history-header">
        <h3 className="wallet-section-title">
          History
          <span
            className="wallet-info-icon"
            title="Portfolio value is recorded each time prices refresh, so history builds up as you use the app."
          >
            <Icon name="info" size={13} />
          </span>
        </h3>
        <div className="wallet-history-tabs">
          {HISTORY_PERIODS.map((p) => (
            <button
              key={p.label}
              className={'wallet-history-tab' + (period.label === p.label ? ' active' : '')}
              // Drop the hover with the period: hoverIdx indexes into the OLD points array, so
              // keeping it would leave a crosshair pinned to a different snapshot's value.
              onClick={() => {
                setPeriod(p);
                setHoverIdx(null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mounted unconditionally, empty state and all: the ResizeObserver attaches once on mount,
          so a container that only appears with data would never get observed — the effect would
          have already run and bailed on a null ref, leaving size.w at 0 and the SVG permanently
          unrendered. The empty state lives inside for the same reason. */}
      <div className="wallet-history-chart" ref={chartRef}>
        {data.length < 2 ? (
          <div className="wallet-history-empty">
            Collecting data — chart will appear as portfolio values are recorded.
          </div>
        ) : (
          <>
            {chart && (
          <svg
            className="wallet-history-svg"
            width={chart.W}
            height={chart.H}
            viewBox={`0 0 ${chart.W} ${chart.H}`}
            role="img"
            aria-label="Portfolio value over time"
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id="ovAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={chart.color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {chart.yTicks.map((t, i) => (
              <g key={i}>
                <line
                  x1={chart.pad.left}
                  y1={t.y}
                  x2={chart.W - chart.pad.right}
                  y2={t.y}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                  opacity="0.4"
                />
                <text x={chart.pad.left - 8} y={t.y + 3} textAnchor="end" className="wallet-axis-label">
                  {t.label}
                </text>
              </g>
            ))}
            {chart.xTicks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={chart.H - 10}
                textAnchor="middle"
                className="wallet-axis-label"
              >
                {t.label}
              </text>
            ))}
            <path d={chart.area} fill="url(#ovAreaGrad)" />
            <path d={chart.line} fill="none" stroke={chart.color} strokeWidth="2" />

            {hovered && (
              <g className="wallet-hover-marker" pointerEvents="none">
                <line
                  x1={hovered.x}
                  y1={chart.pad.top}
                  x2={hovered.x}
                  y2={chart.pad.top + chart.innerH}
                  stroke="var(--muted)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.6"
                />
                <circle cx={hovered.x} cy={hovered.y} r="4" fill={chart.color} />
                <circle
                  cx={hovered.x}
                  cy={hovered.y}
                  r="4"
                  fill="none"
                  stroke="var(--bg)"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
          )}

          {chart && hovered && (
            // Flips to the left of the cursor near the right edge so it never spills the card.
            <div
              className="wallet-chart-tooltip"
              style={
                hovered.x > chart.W - 150
                  ? { right: chart.W - hovered.x + 12 }
                  : { left: hovered.x + 12 }
              }
            >
              <div className="wallet-tooltip-time">{fmtStamp(hovered.t)}</div>
              <div className="wallet-tooltip-row">
                <span className="wallet-tooltip-dot" style={{ backgroundColor: chart.color }} />
                <span className="wallet-tooltip-label">Portfolio:</span>
                <span className="wallet-tooltip-value">{fmtUsd(hovered.value)}</span>
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Hover hints ──

/** What each dashboard panel means, in a few words. Keyed by the hint's target. */
const HINTS: Record<string, string> = {
  'all-time-profit': 'Current value minus what you paid.',
  'cost-basis': 'Total paid for your holdings.',
  'best-performer': 'Biggest gain vs. buy price.',
  'worst-performer': 'Biggest loss vs. buy price.',
  allocation: 'Share of portfolio value per asset.',
};

/**
 * Wraps a panel and shows an explanatory box on hover. Focusable so the hint is reachable by
 * keyboard, not just by mouse — the panels themselves aren't interactive otherwise.
 */
function WithHint({
  hint,
  className,
  children,
}: {
  hint: keyof typeof HINTS | string;
  className: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const text = HINTS[hint];

  return (
    <div
      className={className + ' wallet-hinted'}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && text && (
        <div className="wallet-tip" role="tooltip">
          {text}
        </div>
      )}
    </div>
  );
}

// ── Main view ──

export default function WalletViewWeb({ addAssetSignal = 0 }: { addAssetSignal?: number }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  // Seed from the session cache so a revisit (or a return from another folder tab) shows the last
  // prices immediately instead of an empty table; the poll below refreshes them.
  const [prices, setPrices] = useState<PriceMap>(() => getMarketPrices() ?? {});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [assetTab, setAssetTab] = useState<'assets' | 'transactions'>('assets');

  // localStorage is client-only; seed after mount so SSR and first paint agree.
  useEffect(() => {
    setHoldings(loadHoldings());
    setSnapshots(loadSnapshots());
  }, []);

  // The sidebar's Add Asset button bumps a counter rather than calling in directly (same pattern as
  // JournalShell's New Trade); opening the modal is this component's business.
  useEffect(() => {
    if (addAssetSignal > 0) {
      setEditing(null);
      setModalOpen(true);
    }
  }, [addAssetSignal]);

  const fetchPrices = useCallback(async (current: Holding[]) => {
    if (current.length === 0) {
      setPrices({});
      return;
    }
    try {
      const res = await fetch('/api/market/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          current.map((h) => ({ symbol: h.symbol, asset_type: h.asset_type })),
        ),
      });
      if (!res.ok) return;
      const data = (await res.json()) as PriceMap;
      setPrices(data);
      setMarketPrices(data);

      const total = current.reduce((sum, h) => sum + h.amount * (data[h.symbol]?.price || 0), 0);
      if (total > 0) setSnapshots(recordSnapshot(total));
    } catch {
      // Keep the last known prices rather than blanking the table on a transient failure.
    }
  }, []);

  useEffect(() => {
    if (holdings.length === 0) return;
    void fetchPrices(holdings);
    const id = setInterval(() => void fetchPrices(holdings), POLL_MS);
    return () => clearInterval(id);
  }, [holdings, fetchPrices]);

  const handleSave = (data: {
    assetType: AssetType;
    symbol: string;
    name: string;
    amount: number;
    avgBuyPrice: number;
    purchasedAt: number;
    feePct: number;
    notes: string;
  }) => {
    if (editing) {
      setHoldings(
        updateHolding(editing.id, {
          amount: data.amount,
          avg_buy_price: data.avgBuyPrice,
          purchased_at: data.purchasedAt,
          fee_pct: data.feePct,
          notes: data.notes,
        }),
      );
    } else {
      setHoldings(
        addHolding({
          symbol: data.symbol,
          name: data.name,
          asset_type: data.assetType,
          amount: data.amount,
          avg_buy_price: data.avgBuyPrice,
          purchased_at: data.purchasedAt,
          fee_pct: data.feePct,
          notes: data.notes,
        }),
      );
    }
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = (h: Holding) => {
    if (!window.confirm(`Remove ${h.name} from your wallet?`)) return;
    setHoldings(removeHolding(h.id));
  };

  const openEdit = (h: Holding) => {
    setEditing(h);
    setModalOpen(true);
  };

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  // ── Derived figures ──
  const totalValue = holdings.reduce((s, h) => s + h.amount * (prices[h.symbol]?.price || 0), 0);
  const totalCost = holdings.reduce((s, h) => s + h.amount * (h.avg_buy_price || 0), 0);
  const totalPnL = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  // Only holdings with both a cost basis and a live price can have a meaningful return.
  const perf = holdings
    .filter((h) => h.avg_buy_price > 0 && (prices[h.symbol]?.price ?? 0) > 0)
    .map((h) => {
      const price = prices[h.symbol]!.price;
      return {
        ...h,
        pnlPct: ((price - h.avg_buy_price) / h.avg_buy_price) * 100,
        pnlUsd: (price - h.avg_buy_price) * h.amount,
      };
    })
    .sort((a, b) => b.pnlPct - a.pnlPct);

  const best = perf.length > 0 ? perf[0] : null;
  // With a single eligible holding, best and worst would be the same row — suppress worst.
  const worst = perf.length > 1 ? perf[perf.length - 1] : null;

  const segments = useMemo(() => {
    const rows = holdings
      .map((h) => ({
        symbol: h.symbol,
        value: h.amount * (prices[h.symbol]?.price || 0),
        color: getAssetColor(h.symbol),
      }))
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value);

    const total = rows.reduce((s, r) => s + r.value, 0);
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return rows.map((r) => {
      const pct = total > 0 ? r.value / total : 0;
      const seg = { ...r, pct, dashLen: pct * circumference, offset };
      offset += seg.dashLen;
      return seg;
    });
  }, [holdings, prices]);

  const circumference = 2 * Math.PI * 70;

  // Transactions are derived from holdings: each holding records one purchase (amount + avg buy
  // price + date + fee + notes), which is exactly one "Buy" row. A full buy/sell log would need its
  // own store — this reflects the data we actually have, newest purchase first.
  const transactions = useMemo(
    () =>
      holdings
        .filter((h) => h.amount > 0)
        .map((h) => ({
          h,
          when: h.purchased_at ?? 0,
          price: h.avg_buy_price || 0,
          cost: h.amount * (h.avg_buy_price || 0),
          fee: h.fee_pct && h.avg_buy_price ? h.amount * h.avg_buy_price * (h.fee_pct / 100) : 0,
        }))
        .sort((a, b) => b.when - a.when),
    [holdings],
  );

  if (holdings.length === 0) {
    return (
      <div className="wallet-view">
        <div className="wallet-empty">
          <span className="wallet-empty-icon">
            <Icon name="box" size={44} />
          </span>
          <h2>No holdings yet</h2>
          <p>Add an asset to start tracking your portfolio.</p>
          <button className="btn-primary" onClick={openAdd}>
            <Icon name="plus" size={16} /> Add Asset
          </button>
        </div>
        {modalOpen && (
          <AddAssetModal
            holding={editing}
            onSave={handleSave}
            onClose={() => {
              setModalOpen(false);
              setEditing(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="wallet-view">
      {/* ── Stat cards ── */}
      <div className="wallet-stats-row">
        <WithHint hint="all-time-profit" className="wallet-stat-card">
          <span className="wallet-stat-label">All-Time Profit</span>
          <span className={'wallet-stat-value ' + (totalPnL >= 0 ? 'profit' : 'loss')}>
            {totalPnL < 0 ? '-' : ''}
            {fmtUsd(totalPnL)}
          </span>
          {totalCost > 0 && (
            <span className={'wallet-stat-sub ' + (totalPnL >= 0 ? 'profit' : 'loss')}>
              <Icon name={totalPnL >= 0 ? 'trending-up' : 'trending-down'} size={13} />
              {Math.abs(totalPnLPct).toFixed(2)}%
            </span>
          )}
        </WithHint>

        <WithHint hint="cost-basis" className="wallet-stat-card">
          <span className="wallet-stat-label">Cost Basis</span>
          <span className="wallet-stat-value neutral">{fmtUsd(totalCost)}</span>
        </WithHint>

        <WithHint hint="best-performer" className="wallet-stat-card">
          <span className="wallet-stat-label">Best Performer</span>
          {best ? (
            <>
              <span className="wallet-stat-performer">
                <AssetIcon symbol={best.symbol} assetType={best.asset_type} size={26} />
                <span className="wallet-performer-name">{best.symbol}</span>
              </span>
              <span className={'wallet-stat-sub ' + (best.pnlUsd >= 0 ? 'profit' : 'loss')}>
                {best.pnlUsd >= 0 ? '+' : '-'}
                {fmtUsd(best.pnlUsd)}
                <Icon name={best.pnlPct >= 0 ? 'trending-up' : 'trending-down'} size={13} />
                {Math.abs(best.pnlPct).toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="wallet-stat-value neutral">—</span>
          )}
        </WithHint>

        <WithHint hint="worst-performer" className="wallet-stat-card">
          <span className="wallet-stat-label">Worst Performer</span>
          {worst ? (
            <>
              <span className="wallet-stat-performer">
                <AssetIcon symbol={worst.symbol} assetType={worst.asset_type} size={26} />
                <span className="wallet-performer-name">{worst.symbol}</span>
              </span>
              <span className={'wallet-stat-sub ' + (worst.pnlUsd >= 0 ? 'profit' : 'loss')}>
                {worst.pnlUsd >= 0 ? '+' : '-'}
                {fmtUsd(worst.pnlUsd)}
                <Icon name={worst.pnlPct >= 0 ? 'trending-up' : 'trending-down'} size={13} />
                {Math.abs(worst.pnlPct).toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="wallet-stat-value neutral">—</span>
          )}
        </WithHint>
      </div>

      {/* ── Charts ── */}
      <div className="wallet-charts-row">
        <PortfolioHistory snapshots={snapshots} liveValue={totalValue} />

        {segments.length > 0 && (
          <WithHint hint="allocation" className="wallet-allocation-card">
            <h3 className="wallet-section-title">Allocation</h3>
            <div className="wallet-alloc-body">
              <div className="wallet-donut-wrap">
                <svg
                  className="wallet-donut"
                  viewBox="0 0 200 200"
                  role="img"
                  aria-label="Allocation by asset"
                >
                  {/* -90° so the first segment starts at 12 o'clock rather than 3 o'clock. */}
                  <g transform="rotate(-90 100 100)">
                    <circle
                      cx="100"
                      cy="100"
                      r="70"
                      fill="none"
                      stroke="var(--border)"
                      strokeWidth="24"
                      opacity="0.25"
                    />
                    {segments.map((s) => (
                      <circle
                        key={s.symbol}
                        cx="100"
                        cy="100"
                        r="70"
                        fill="none"
                        stroke={s.color}
                        strokeWidth="24"
                        strokeDasharray={`${s.dashLen} ${circumference - s.dashLen}`}
                        strokeDashoffset={-s.offset}
                      />
                    ))}
                  </g>
                </svg>
                <div className="wallet-donut-center">
                  <span className="wallet-donut-total">{fmtUsd(totalValue, 0)}</span>
                </div>
              </div>
              <div className="wallet-alloc-legend">
                {segments.map((s) => (
                  <div key={s.symbol} className="wallet-legend-row">
                    <span className="wallet-legend-dot" style={{ backgroundColor: s.color }} />
                    <span className="wallet-legend-sym">{s.symbol}</span>
                    <span className="wallet-legend-pct">{(s.pct * 100).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </WithHint>
        )}
      </div>

      {/* ── Assets / Transactions ── */}
      <div className="wallet-assets-card">
        <div className="wallet-assets-header">
          <div className="wallet-asset-tabs">
            <button
              className={'wallet-asset-tab' + (assetTab === 'assets' ? ' active' : '')}
              onClick={() => setAssetTab('assets')}
            >
              Assets
            </button>
            <button
              className={'wallet-asset-tab' + (assetTab === 'transactions' ? ' active' : '')}
              onClick={() => setAssetTab('transactions')}
            >
              Transactions
            </button>
          </div>
          <button className="btn-primary btn-sm" onClick={openAdd}>
            <Icon name="plus" size={15} /> Add Asset
          </button>
        </div>

        {assetTab === 'transactions' ? (
          <div className="wallet-table wallet-tx-table">
            <div className="wallet-thead">
              <span className="wtx-type">Type</span>
              <span className="wtx-date">Date</span>
              <span className="wtx-asset">Assets</span>
              <span className="wtx-price">Price</span>
              <span className="wtx-amount">Amount</span>
              <span className="wtx-fees">Fees</span>
              <span className="wtx-notes">Notes</span>
              <span className="wt-actions">Actions</span>
            </div>

            {transactions.length === 0 ? (
              <div className="wallet-history-empty">No transactions yet.</div>
            ) : (
              transactions.map(({ h, when, price, cost, fee }) => (
                <div key={h.id} className="wallet-trow">
                  <span className="wtx-type">
                    <span className="wtx-type-badge">
                      <Icon name="refresh-cw" size={14} />
                    </span>
                    Buy
                  </span>

                  <span className="wtx-date">
                    {when
                      ? new Date(when).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : '—'}
                  </span>

                  <span className="wtx-asset">
                    <AssetIcon symbol={h.symbol} assetType={h.asset_type} size={26} />
                    <span className="wt-name-text">{h.name}</span>
                    <span className="wt-sym-text">{h.symbol}</span>
                  </span>

                  <span className="wtx-price">{price > 0 ? fmtPrice(price) : '—'}</span>

                  <span className="wtx-amount">
                    <span className="wtx-amount-qty profit">
                      +{h.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {h.symbol}
                    </span>
                    <span className="wtx-amount-usd">{cost > 0 ? fmtUsd(cost) : '—'}</span>
                  </span>

                  <span className="wtx-fees">{fee > 0 ? fmtUsd(fee) : '--'}</span>

                  <span className="wtx-notes">{h.notes ? h.notes : '--'}</span>

                  <span className="wt-actions">
                    <button
                      className="wallet-action-btn"
                      onClick={() => openEdit(h)}
                      aria-label={`Edit ${h.name} transaction`}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      className="wallet-action-btn delete"
                      onClick={() => handleDelete(h)}
                      aria-label={`Remove ${h.name} transaction`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
        <div className="wallet-table">
          <div className="wallet-thead">
            <span className="wt-name">Name</span>
            <span className="wt-price">Price</span>
            <span className="wt-change">24h%</span>
            <span className="wt-holdings">Holdings</span>
            <span className="wt-avg">Avg. Buy Price</span>
            <span className="wt-pnl">Profit/Loss</span>
            <span className="wt-actions">Actions</span>
          </div>

          {holdings.map((h) => {
            const quote = prices[h.symbol];
            const price = quote?.price ?? 0;
            const change = quote?.change24h ?? 0;
            const value = h.amount * price;
            const cost = h.amount * (h.avg_buy_price || 0);
            const pnl = value - cost;
            const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
            const hasPnL = h.avg_buy_price > 0 && price > 0;

            return (
              <div key={h.id} className="wallet-trow">
                <span className="wt-name">
                  <AssetIcon symbol={h.symbol} assetType={h.asset_type} size={34} />
                  <span className="wt-name-text">{h.name}</span>
                  <span className="wt-sym-text">{h.symbol}</span>
                </span>

                <span className="wt-price">{price > 0 ? fmtPrice(price) : '—'}</span>

                <span className={'wt-change ' + (change >= 0 ? 'profit' : 'loss')}>
                  {quote ? (
                    <>
                      <Icon name={change >= 0 ? 'trending-up' : 'trending-down'} size={13} />
                      {Math.abs(change).toFixed(2)}%
                    </>
                  ) : (
                    '—'
                  )}
                </span>

                <span className="wt-holdings">
                  {price > 0 ? (
                    <>
                      <span className="wt-h-value">{fmtUsd(value)}</span>
                      <span className="wt-h-amount">
                        {h.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {h.symbol}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>

                <span className="wt-avg">
                  {h.avg_buy_price > 0 ? fmtPrice(h.avg_buy_price) : '—'}
                </span>

                <span className={'wt-pnl ' + (hasPnL ? (pnl >= 0 ? 'profit' : 'loss') : '')}>
                  {hasPnL ? (
                    <>
                      <span className="wt-pnl-usd">
                        {pnl >= 0 ? '+' : '-'}
                        {fmtUsd(pnl)}
                      </span>
                      <span className="wt-pnl-pct">
                        <Icon name={pnl >= 0 ? 'trending-up' : 'trending-down'} size={12} />
                        {Math.abs(pnlPct).toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>

                <span className="wt-actions">
                  <button
                    className="wallet-action-btn"
                    onClick={() => openEdit(h)}
                    aria-label={`Edit ${h.name}`}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="wallet-action-btn delete"
                    onClick={() => handleDelete(h)}
                    aria-label={`Remove ${h.name}`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {modalOpen && (
        <AddAssetModal
          holding={editing}
          onSave={handleSave}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
