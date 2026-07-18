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
  valueAgo,
} from './holdings';
import { Icon } from './icons';
import {
  createPortfolio,
  deletePortfolio,
  ensurePortfolios,
  getActiveId,
  loadPortfolios,
  type PortfolioMeta,
  renamePortfolio,
  setActivePortfolio,
} from './portfolios';

// CoinMarketCap-style Portfolio view. The three Overview chips each swap the whole panel below them
// — a filter row would only hide rows; here Holdings / All-time profit / Allocation change the chart
// AND the asset table's third column, matching the CMC phone app the design was taken from.
//
// Charts are hand-rolled inline SVG (no charting lib for a couple of lines and a donut). Live prices
// come from /api/market/prices; the orange "BTC trend" comparison line from /api/market/klines.

interface Quote {
  price: number;
  change24h: number;
}
type PriceMap = Record<string, Quote | null>;

const POLL_MS = 30_000;
const CHART_H = 200;

type ChipKey = 'holdings' | 'profit' | 'allocation';
const CHIPS: { key: ChipKey; label: string }[] = [
  { key: 'holdings', label: 'Holdings' },
  { key: 'profit', label: 'All-time profit' },
  { key: 'allocation', label: 'Allocation' },
];

const PERIODS: { label: string; hours: number | null; range: string }[] = [
  { label: '24h', hours: 24, range: '24h' },
  { label: '7d', hours: 168, range: '7d' },
  { label: '30d', hours: 720, range: '30d' },
  { label: '90d', hours: 2160, range: '90d' },
  { label: 'All', hours: null, range: 'all' },
];

interface KlinePoint {
  t: number;
  close: number;
}

// ── Small shared chart helpers ──

function useChartSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: CHART_H });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) || CHART_H });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

// ── Holdings chart: portfolio value over time (filled area) ──

function ValueChart({
  snapshots,
  liveValue,
  period,
}: {
  snapshots: Snapshot[];
  liveValue: number;
  period: (typeof PERIODS)[number];
}) {
  const { ref, size } = useChartSize();

  const data = useMemo(() => {
    const now = Date.now();
    const cutoff = period.hours ? now - period.hours * 3600_000 : 0;
    let inRange = snapshots.filter((s) => s.t >= cutoff);

    // Snapshots record the *portfolio total*, so adding/removing a holding (or switching portfolios)
    // makes the series jump — e.g. $63k for a week, then $92k the instant ETH is added. That vertical
    // step is real data but reads as a chart glitch. Treat a >20% jump between consecutive snapshots
    // as a composition change and keep only the run after the last such jump, so the chart shows the
    // current portfolio's history rather than splicing two different totals together.
    let start = 0;
    for (let i = 1; i < inRange.length; i++) {
      const prev = inRange[i - 1].value;
      if (prev > 0 && Math.abs(inRange[i].value - prev) / prev > 0.2) start = i;
    }
    if (start > 0) inRange = inRange.slice(start);

    if (liveValue <= 0) return inRange;
    if (inRange.length === 0) return [{ t: now, value: liveValue }];

    // Only append the live "now" point when it's continuous with history: >60s newer than the last
    // snapshot (a just-recorded one already IS the live value) and within 20% of it.
    const last = inRange[inRange.length - 1];
    const ageOk = now - last.t > 60_000;
    const deltaOk = last.value > 0 && Math.abs(liveValue - last.value) / last.value <= 0.2;
    return ageOk && deltaOk ? [...inRange, { t: now, value: liveValue }] : inRange;
  }, [snapshots, liveValue, period]);

  const chart = useMemo(() => {
    if (data.length < 2 || size.w === 0) return null;
    const W = size.w;
    const H = size.h;
    // The line spans the full width (x starts at 0); labels float over the right edge like the CMC
    // reference, so there's no left gutter and no right column stealing plot width. A little top/
    // bottom breathing room keeps the curve off the edges.
    const pad = { top: 12, right: 4, bottom: 22, left: 0 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const values = data.map((d) => d.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    // Floor the visible span at 1% of the value. Without this, two snapshots $40 apart on a $255k
    // portfolio get scaled to fill the whole box — turning sub-0.02% noise into a jagged "broken"
    // line. A 1% floor keeps a genuinely flat portfolio reading flat until the moves are real.
    const mid = (min + max) / 2 || 1;
    const minSpan = Math.abs(mid) * 0.01;
    if (max - min < minSpan) {
      min = mid - minSpan / 2;
      max = mid + minSpan / 2;
    }
    // Pad the value range 8% each side so the line never rides the very top/bottom of the box.
    const spanPad = (max - min) * 0.08;
    min -= spanPad;
    max += spanPad;
    const t0 = data[0].t;
    const tSpan = data[data.length - 1].t - t0 || 1;
    const x = (t: number) => pad.left + ((t - t0) / tSpan) * innerW;
    const y = (v: number) => pad.top + (1 - (v - min) / (max - min)) * innerH;
    const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.t)},${y(d.value)}`).join(' ');
    const area = `${line} L${x(data[data.length - 1].t)},${pad.top + innerH} L${x(t0)},${pad.top + innerH} Z`;
    const up = values[values.length - 1] >= values[0];
    const color = up ? '#22c55e' : '#ef4444';

    const fmtAxis = (v: number) => {
      if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
      if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
      return `$${v.toFixed(0)}`;
    };
    // Skip the extreme ticks (the padded min/max) so labels don't clip the box edges.
    const yTicks = [0.2, 0.45, 0.7, 0.95].map((f) => {
      const v = min + (max - min) * f;
      return { y: y(v), label: fmtAxis(v) };
    });
    return { W, H, pad, innerW, innerH, line, area, color, yTicks };
  }, [data, size]);

  return (
    <div className="wallet-chart-box" ref={ref}>
      {data.length < 2 ? (
        <div className="wallet-history-empty">
          Collecting data — chart will appear as portfolio values are recorded.
        </div>
      ) : (
        chart && (
          <svg
            className="wallet-history-svg"
            width={chart.W}
            height={chart.H}
            viewBox={`0 0 ${chart.W} ${chart.H}`}
            role="img"
            aria-label="Portfolio value over time"
          >
            <defs>
              <linearGradient id="ovValGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={chart.color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {chart.yTicks.map((t, i) => (
              <g key={i}>
                <line
                  x1={0}
                  y1={t.y}
                  x2={chart.W}
                  y2={t.y}
                  stroke="var(--border)"
                  strokeWidth="0.5"
                  opacity="0.35"
                />
                <text x={chart.W - chart.pad.right} y={t.y - 4} textAnchor="end" className="wallet-axis-label">
                  {t.label}
                </text>
              </g>
            ))}
            <path d={chart.area} fill="url(#ovValGrad)" />
            <path d={chart.line} fill="none" stroke={chart.color} strokeWidth="2" />
          </svg>
        )
      )}
    </div>
  );
}

// ── All-time-profit chart: portfolio profit-% line + BTC trend-% line ──

function ProfitChart({
  snapshots,
  liveValue,
  totalCost,
  btc,
  period,
  profitPct,
}: {
  snapshots: Snapshot[];
  liveValue: number;
  totalCost: number;
  btc: KlinePoint[];
  period: (typeof PERIODS)[number];
  profitPct: number;
}) {
  const { ref, size } = useChartSize();

  // Portfolio profit as a % of cost, over time. Snapshot value → (value - cost)/cost.
  const profitSeries = useMemo(() => {
    if (totalCost <= 0) return [];
    const now = Date.now();
    const cutoff = period.hours ? now - period.hours * 3600_000 : 0;
    let inRange = snapshots.filter((s) => s.t >= cutoff);
    // Trim history before the last >20% composition jump (same reasoning as ValueChart).
    let start = 0;
    for (let i = 1; i < inRange.length; i++) {
      const prev = inRange[i - 1].value;
      if (prev > 0 && Math.abs(inRange[i].value - prev) / prev > 0.2) start = i;
    }
    if (start > 0) inRange = inRange.slice(start);

    const pts = inRange.map((s) => ({ t: s.t, v: ((s.value - totalCost) / totalCost) * 100 }));
    const last = inRange[inRange.length - 1];
    const contiguous =
      !last || (now - last.t > 60_000 && last.value > 0 && Math.abs(liveValue - last.value) / last.value <= 0.2);
    if (liveValue > 0 && contiguous) pts.push({ t: now, v: ((liveValue - totalCost) / totalCost) * 100 });
    return pts;
  }, [snapshots, liveValue, totalCost, period]);

  // BTC as a % change relative to the window's first close — a trend line, not an absolute price.
  const btcSeries = useMemo(() => {
    const cutoff = period.hours ? Date.now() - period.hours * 3600_000 : 0;
    const inRange = btc.filter((p) => p.t >= cutoff);
    if (inRange.length < 2) return [];
    const base = inRange[0].close;
    return inRange.map((p) => ({ t: p.t, v: ((p.close - base) / base) * 100 }));
  }, [btc, period]);

  const chart = useMemo(() => {
    const all = [...profitSeries, ...btcSeries];
    if (all.length < 2 || size.w === 0) return null;
    const W = size.w;
    const H = size.h;
    const pad = { top: 10, right: 46, bottom: 24, left: 12 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const ts = all.map((p) => p.t);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const tSpan = t1 - t0 || 1;
    const vs = all.map((p) => p.v);
    let min = Math.min(...vs, 0);
    let max = Math.max(...vs, 0);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const x = (t: number) => pad.left + ((t - t0) / tSpan) * innerW;
    const y = (v: number) => pad.top + (1 - (v - min) / (max - min)) * innerH;
    const path = (pts: { t: number; v: number }[]) =>
      pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)},${y(p.v)}`).join(' ');

    const yTicks = Array.from({ length: 4 }, (_, i) => {
      const v = min + ((max - min) * i) / 3;
      return { y: y(v), label: `${v.toFixed(1)}%` };
    });
    return {
      W,
      H,
      pad,
      innerH,
      profitPath: profitSeries.length > 1 ? path(profitSeries) : '',
      btcPath: btcSeries.length > 1 ? path(btcSeries) : '',
      yTicks,
    };
  }, [profitSeries, btcSeries, size]);

  const btcTrendPct = btcSeries.length > 1 ? btcSeries[btcSeries.length - 1].v : 0;

  return (
    <>
      <div className="wallet-chart-box" ref={ref}>
        {!chart || totalCost <= 0 ? (
          <div className="wallet-history-empty">
            {totalCost <= 0
              ? 'Add a buy price to see profit over time.'
              : 'Collecting data — chart will appear as portfolio values are recorded.'}
          </div>
        ) : (
          <svg
            className="wallet-history-svg"
            width={chart.W}
            height={chart.H}
            viewBox={`0 0 ${chart.W} ${chart.H}`}
            role="img"
            aria-label="All-time profit over time"
          >
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
                <text x={chart.W - chart.pad.right + 4} y={t.y + 3} textAnchor="start" className="wallet-axis-label">
                  {t.label}
                </text>
              </g>
            ))}
            {chart.btcPath && (
              <path d={chart.btcPath} fill="none" stroke="#e0a463" strokeWidth="1.5" opacity="0.9" />
            )}
            {chart.profitPath && (
              <path d={chart.profitPath} fill="none" stroke="#3b6ef6" strokeWidth="2" />
            )}
          </svg>
        )}
      </div>
      <div className="wallet-profit-legend">
        <span className="wallet-legend-row">
          <span className="wallet-legend-dot" style={{ backgroundColor: '#3b6ef6' }} />
          <span className="wallet-legend-sym">All-time Profit:</span>
          <span className={profitPct >= 0 ? 'profit' : 'loss'}>
            {profitPct >= 0 ? '▲' : '▼'} {Math.abs(profitPct).toFixed(2)}%
          </span>
        </span>
        <span className="wallet-legend-row">
          <span className="wallet-legend-dot" style={{ backgroundColor: '#e0a463' }} />
          <span className="wallet-legend-sym">BTC trend:</span>
          <span className={btcTrendPct >= 0 ? 'profit' : 'loss'}>
            {btcTrendPct >= 0 ? '▲' : '▼'} {Math.abs(btcTrendPct).toFixed(2)}%
          </span>
        </span>
      </div>
    </>
  );
}

// ── Allocation donut ──

function AllocationPanel({
  segments,
  totalValue,
}: {
  segments: { symbol: string; pct: number; color: string; dashLen: number; offset: number }[];
  totalValue: number;
}) {
  const circumference = 2 * Math.PI * 70;
  if (segments.length === 0) {
    return <div className="wallet-history-empty">Add an asset to see your allocation.</div>;
  }
  return (
    <div className="wallet-alloc-body">
      <div className="wallet-donut-wrap">
        <svg className="wallet-donut" viewBox="0 0 200 200" role="img" aria-label="Allocation by asset">
          <g transform="rotate(-90 100 100)">
            <circle cx="100" cy="100" r="70" fill="none" stroke="var(--border)" strokeWidth="22" opacity="0.25" />
            {segments.map((s) => (
              <circle
                key={s.symbol}
                cx="100"
                cy="100"
                r="70"
                fill="none"
                stroke={s.color}
                strokeWidth="22"
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
  );
}

// ── Portfolio switcher (name ▾ with switch / create / rename / delete) ──

function PortfolioSwitcher({
  portfolios,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  portfolios: PortfolioMeta[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const active = portfolios.find((p) => p.id === activeId) ?? portfolios[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const create = () => {
    const name = window.prompt('New portfolio name');
    if (name && name.trim()) onCreate(name.trim());
    setOpen(false);
  };
  const rename = (p: PortfolioMeta) => {
    const name = window.prompt('Rename portfolio', p.name);
    if (name && name.trim()) onRename(p.id, name.trim());
  };
  const del = (p: PortfolioMeta) => {
    if (portfolios.length <= 1) return;
    if (window.confirm(`Delete "${p.name}"? Its holdings will be removed.`)) onDelete(p.id);
  };

  return (
    <div className="wallet-switcher" ref={wrapRef}>
      <button className="wallet-switcher-btn" onClick={() => setOpen((v) => !v)}>
        <span className="wallet-switcher-name">{active?.name ?? 'Portfolio'}</span>
        <Icon name="chevron-down" size={18} />
      </button>
      {open && (
        <div className="wallet-switcher-menu" role="menu">
          {portfolios.map((p) => (
            <div key={p.id} className={'wallet-switcher-item' + (p.id === activeId ? ' active' : '')}>
              <button className="wallet-switcher-pick" onClick={() => { onSwitch(p.id); setOpen(false); }}>
                {p.id === activeId && <Icon name="check" size={14} />}
                <span>{p.name}</span>
              </button>
              <button className="wallet-switcher-edit" onClick={() => rename(p)} aria-label={`Rename ${p.name}`}>
                <Icon name="edit" size={13} />
              </button>
              {portfolios.length > 1 && (
                <button className="wallet-switcher-edit" onClick={() => del(p)} aria-label={`Delete ${p.name}`}>
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>
          ))}
          <button className="wallet-switcher-new" onClick={create}>
            <Icon name="plus" size={14} /> New portfolio
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main view ──

export default function WalletView({ addAssetSignal = 0 }: { addAssetSignal?: number }) {
  const [portfolios, setPortfolios] = useState<PortfolioMeta[]>([]);
  const [activeId, setActiveId] = useState<string>('main');
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [prices, setPrices] = useState<PriceMap>(() => getMarketPrices() ?? {});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [btc, setBtc] = useState<KlinePoint[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [hidden, setHidden] = useState(false);
  const [tab, setTab] = useState<'overview' | 'transactions'>('overview');
  const [chip, setChip] = useState<ChipKey>('holdings');
  const [period, setPeriod] = useState(PERIODS[0]);
  const [sortDesc, setSortDesc] = useState(true);

  // Migrate/seed portfolios, then load the active portfolio's holdings + snapshots.
  useEffect(() => {
    ensurePortfolios();
    setPortfolios(loadPortfolios());
    setActiveId(getActiveId());
    setHoldings(loadHoldings());
    setSnapshots(loadSnapshots());
  }, []);

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
        body: JSON.stringify(current.map((h) => ({ symbol: h.symbol, asset_type: h.asset_type }))),
      });
      if (!res.ok) return;
      const data = (await res.json()) as PriceMap;
      setPrices(data);
      setMarketPrices(data);
      const total = current.reduce((sum, h) => sum + h.amount * (data[h.symbol]?.price || 0), 0);
      if (total > 0) setSnapshots(recordSnapshot(total));
    } catch {
      /* keep last prices on a transient failure */
    }
  }, []);

  useEffect(() => {
    if (holdings.length === 0) return;
    void fetchPrices(holdings);
    const id = setInterval(() => void fetchPrices(holdings), POLL_MS);
    return () => clearInterval(id);
  }, [holdings, fetchPrices]);

  // BTC trend line for the All-time-profit chart. Refetched when the window changes; only needed
  // while that chip is showing.
  useEffect(() => {
    if (chip !== 'profit') return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/market/klines?symbol=BTC&range=${period.range}`);
        if (!res.ok) return;
        const data = (await res.json()) as { points: KlinePoint[] };
        if (alive) setBtc(data.points ?? []);
      } catch {
        /* no trend line this time */
      }
    })();
    return () => {
      alive = false;
    };
  }, [chip, period]);

  const refreshHoldings = (next: Holding[]) => setHoldings(next);

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
      refreshHoldings(
        updateHolding(editing.id, {
          amount: data.amount,
          avg_buy_price: data.avgBuyPrice,
          purchased_at: data.purchasedAt,
          fee_pct: data.feePct,
          notes: data.notes,
        }),
      );
    } else {
      refreshHoldings(
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
    refreshHoldings(removeHolding(h.id));
  };
  const openEdit = (h: Holding) => {
    setEditing(h);
    setModalOpen(true);
  };
  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  // Switching portfolios re-points holdings.ts at the new key, so reload from it.
  const switchTo = (id: string) => {
    setActivePortfolio(id);
    setActiveId(id);
    setHoldings(loadHoldings());
    setPrices({});
  };
  const doCreate = (name: string) => {
    createPortfolio(name);
    setPortfolios(loadPortfolios());
    setActiveId(getActiveId());
    setHoldings(loadHoldings());
    setPrices({});
  };
  const doRename = (id: string, name: string) => {
    renamePortfolio(id, name);
    setPortfolios(loadPortfolios());
  };
  const doDelete = (id: string) => {
    deletePortfolio(id);
    setPortfolios(loadPortfolios());
    setActiveId(getActiveId());
    setHoldings(loadHoldings());
    setPrices({});
  };

  // ── Derived figures ──
  const totalValue = holdings.reduce((s, h) => s + h.amount * (prices[h.symbol]?.price || 0), 0);
  const totalCost = holdings.reduce((s, h) => s + h.amount * (h.avg_buy_price || 0), 0);
  const totalPnL = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const dayAgo = valueAgo(snapshots, 24);

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
    const circumference = 2 * Math.PI * 70;
    let offset = 0;
    return rows.map((r) => {
      const pct = total > 0 ? r.value / total : 0;
      const seg = { ...r, pct, dashLen: pct * circumference, offset };
      offset += seg.dashLen;
      return seg;
    });
  }, [holdings, prices]);

  // Per-row figures for the asset table, plus the sort key that the active chip drives.
  const rows = useMemo(() => {
    const mapped = holdings.map((h) => {
      const quote = prices[h.symbol];
      const price = quote?.price ?? 0;
      const change = quote?.change24h ?? 0;
      const value = h.amount * price;
      const cost = h.amount * (h.avg_buy_price || 0);
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      const alloc = totalValue > 0 ? value / totalValue : 0;
      const hasPnL = h.avg_buy_price > 0 && price > 0;
      return { h, quote, price, change, value, pnl, pnlPct, alloc, hasPnL };
    });
    const key =
      chip === 'profit' ? (r: (typeof mapped)[number]) => r.pnl
      : chip === 'allocation' ? (r: (typeof mapped)[number]) => r.alloc
      : (r: (typeof mapped)[number]) => r.value;
    mapped.sort((a, b) => (sortDesc ? key(b) - key(a) : key(a) - key(b)));
    return mapped;
  }, [holdings, prices, totalValue, chip, sortDesc]);

  const thirdColLabel = chip === 'profit' ? 'All-time profit' : chip === 'allocation' ? 'Allocation' : 'Holdings';
  const showPills = chip !== 'allocation';

  // Transactions are derived from holdings: each holding records one purchase (amount + avg buy
  // price + date), which is exactly one "Buy" row. A full buy/sell log would need its own store —
  // this reflects the data we actually have, grouped by purchase day (newest first).
  const txGroups = useMemo(() => {
    const txns = holdings
      .filter((h) => h.amount > 0)
      .map((h) => ({
        h,
        when: h.purchased_at ?? 0,
        cost: h.amount * (h.avg_buy_price || 0),
      }))
      .sort((a, b) => b.when - a.when);

    const groups: { day: string; items: typeof txns }[] = [];
    for (const tx of txns) {
      const day = tx.when
        ? new Date(tx.when).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Date unknown';
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(tx);
      else groups.push({ day, items: [tx] });
    }
    return groups;
  }, [holdings]);

  const money = (n: number) => (hidden ? '••••' : fmtUsd(n));

  // ── Empty state ──
  if (holdings.length === 0) {
    return (
      <div className="wallet-view">
        <PortfolioHeaderBar
          portfolios={portfolios}
          activeId={activeId}
          totalValue={0}
          totalCost={0}
          dayAgo={null}
          hidden={hidden}
          onToggleHide={() => setHidden((v) => !v)}
          onAdd={openAdd}
          onSwitch={switchTo}
          onCreate={doCreate}
          onRename={doRename}
          onDelete={doDelete}
        />
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
          <AddAssetModal holding={editing} onSave={handleSave} onClose={() => { setModalOpen(false); setEditing(null); }} />
        )}
      </div>
    );
  }

  return (
    <div className="wallet-view">
      <PortfolioHeaderBar
        portfolios={portfolios}
        activeId={activeId}
        totalValue={totalValue}
        totalCost={totalCost}
        dayAgo={dayAgo}
        hidden={hidden}
        onToggleHide={() => setHidden((v) => !v)}
        onAdd={openAdd}
        onSwitch={switchTo}
        onCreate={doCreate}
        onRename={doRename}
        onDelete={doDelete}
      />

      {/* ── Overview / Transactions tab strip ── */}
      <div className="wallet-tabstrip">
        <button
          className={'wallet-tab' + (tab === 'overview' ? ' active' : '')}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          className={'wallet-tab' + (tab === 'transactions' ? ' active' : '')}
          onClick={() => setTab('transactions')}
        >
          Transactions
        </button>
      </div>

      {tab === 'transactions' ? (
        <div className="wallet-tx-list">
          {txGroups.length === 0 ? (
            <div className="wallet-history-empty">No transactions yet.</div>
          ) : (
            txGroups.map((g) => (
              <div key={g.day} className="wallet-tx-group">
                <div className="wallet-tx-day">{g.day}</div>
                {g.items.map(({ h, cost }) => (
                  <div key={h.id} className="wallet-tx-row" onClick={() => openEdit(h)}>
                    <span className="wallet-tx-left">
                      <AssetIcon symbol={h.symbol} assetType={h.asset_type} size={32} />
                      <span className="wallet-tx-type">Buy</span>
                    </span>
                    <span className="wallet-tx-right">
                      <span className="wallet-tx-amount profit">
                        + {hidden ? '••••' : `${h.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${h.symbol}`}
                      </span>
                      <span className="wallet-tx-cost">{hidden ? '••••' : fmtUsd(cost)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
          <button className="wallet-tx-fab" onClick={openAdd} aria-label="New transaction">
            <Icon name="plus" size={24} />
          </button>
        </div>
      ) : (
      <>
      {/* ── Chips ── */}
      <div className="wallet-chips">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            className={'wallet-chip' + (chip === c.key ? ' active' : '')}
            onClick={() => setChip(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Timeframe pills (not on Allocation) ── */}
      {showPills && (
        <div className="wallet-history-tabs wallet-period-row">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              className={'wallet-history-tab' + (period.label === p.label ? ' active' : '')}
              onClick={() => setPeriod(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Panel (swaps with the chip) ── */}
      <div className="wallet-panel">
        {chip === 'holdings' && (
          <ValueChart snapshots={snapshots} liveValue={totalValue} period={period} />
        )}
        {chip === 'profit' && (
          <ProfitChart
            snapshots={snapshots}
            liveValue={totalValue}
            totalCost={totalCost}
            btc={btc}
            period={period}
            profitPct={totalPnLPct}
          />
        )}
        {chip === 'allocation' && <AllocationPanel segments={segments} totalValue={totalValue} />}
      </div>

      {/* ── Asset table ── */}
      <div className="wallet-cmc-table">
        <div className="wallet-cmc-head">
          <span className="wc-asset">Asset</span>
          <span className="wc-price">Price</span>
          <button className="wc-third wc-sortable" onClick={() => setSortDesc((v) => !v)}>
            {thirdColLabel}
            <Icon name={sortDesc ? 'chevron-down' : 'chevron-up'} size={14} />
          </button>
        </div>

        {rows.map(({ h, quote, price, change, value, pnl, pnlPct, alloc, hasPnL }) => (
          <div key={h.id} className="wallet-cmc-row" onClick={() => openEdit(h)}>
            <span className="wc-asset">
              <AssetIcon symbol={h.symbol} assetType={h.asset_type} size={28} />
              <span className="wc-asset-names">
                <span className="wc-asset-name">{h.name}</span>
                <span className="wc-asset-sym">{h.symbol}</span>
              </span>
            </span>

            <span className="wc-price">
              <span className="wc-price-val">{price > 0 ? fmtPrice(price) : '—'}</span>
              {quote && (
                <span className={'wc-price-chg ' + (change >= 0 ? 'profit' : 'loss')}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                </span>
              )}
            </span>

            {/* Third column swaps with the active chip. */}
            {chip === 'holdings' && (
              <span className="wc-third">
                <span className="wc-third-val">{price > 0 ? money(value) : '—'}</span>
                <span className="wc-third-sub">
                  {hidden ? '••••' : `${h.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${h.symbol}`}
                </span>
              </span>
            )}
            {chip === 'profit' && (
              <span className="wc-third">
                {hasPnL ? (
                  <>
                    <span className={'wc-third-val ' + (pnl >= 0 ? 'profit' : 'loss')}>
                      {pnl >= 0 ? '+ ' : '- '}
                      {money(Math.abs(pnl))}
                    </span>
                    <span className={'wc-third-sub ' + (pnl >= 0 ? 'profit' : 'loss')}>
                      {pnl >= 0 ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="wc-third-val">—</span>
                )}
              </span>
            )}
            {chip === 'allocation' && (
              <span className="wc-third">
                <span className="wc-third-val">{(alloc * 100).toFixed(2)}%</span>
                <span className="wc-alloc-bar">
                  <span
                    className="wc-alloc-fill"
                    style={{ width: `${Math.min(100, alloc * 100)}%`, backgroundColor: getAssetColor(h.symbol) }}
                  />
                </span>
              </span>
            )}
          </div>
        ))}
      </div>

      <button className="wallet-new-tx" onClick={openAdd}>
        <Icon name="plus" size={16} /> New transaction
      </button>
      </>
      )}

      {modalOpen && (
        <AddAssetModal holding={editing} onSave={handleSave} onClose={() => { setModalOpen(false); setEditing(null); }} />
      )}
    </div>
  );
}

// ── Header bar (total, change lines, switcher, hide, add) ──

function PortfolioHeaderBar({
  portfolios,
  activeId,
  totalValue,
  totalCost,
  dayAgo,
  hidden,
  onToggleHide,
  onAdd,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  portfolios: PortfolioMeta[];
  activeId: string;
  totalValue: number;
  totalCost: number;
  dayAgo: number | null;
  hidden: boolean;
  onToggleHide: () => void;
  onAdd: () => void;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : null;
  const day = dayAgo !== null && dayAgo > 0 ? { delta: totalValue - dayAgo, pct: ((totalValue - dayAgo) / dayAgo) * 100 } : null;

  return (
    <div className="wallet-cmc-header">
      <div className="wallet-cmc-toprow">
        <PortfolioSwitcher
          portfolios={portfolios}
          activeId={activeId}
          onSwitch={onSwitch}
          onCreate={onCreate}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>

      <div className="wallet-cmc-totalrow">
        <span className="wallet-cmc-total">{hidden ? '••••••' : fmtUsd(totalValue)}</span>
        <button className="wallet-eye-btn" onClick={onToggleHide} aria-label={hidden ? 'Show value' : 'Hide value'} aria-pressed={hidden}>
          <Icon name={hidden ? 'eye-off' : 'eye'} size={18} />
        </button>
        <button className="wallet-cmc-add" onClick={onAdd} aria-label="Add asset">
          <Icon name="plus" size={18} />
        </button>
      </div>

      {!hidden && (
        <div className="wallet-cmc-changes">
          <ChangeLine label="24h" delta={day?.delta ?? null} pct={day?.pct ?? null} />
          <ChangeLine label="All-time" delta={pnlPct === null ? null : pnl} pct={pnlPct} />
        </div>
      )}
    </div>
  );
}

function ChangeLine({ label, delta, pct }: { label: string; delta: number | null; pct: number | null }) {
  if (delta === null || pct === null) {
    return (
      <div className="wallet-cmc-change">
        <span className="wallet-cmc-change-label">{label}:</span>
        <span className="wallet-cmc-change-none">—</span>
      </div>
    );
  }
  const up = delta >= 0;
  return (
    <div className="wallet-cmc-change">
      <span className="wallet-cmc-change-label">{label}:</span>
      <span className={up ? 'profit' : 'loss'}>
        {up ? '+ ' : '- '}
        {fmtUsd(Math.abs(delta))}
      </span>
      <span className={up ? 'profit' : 'loss'}>
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
      </span>
    </div>
  );
}
