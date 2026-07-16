'use client';

import { useEffect, useRef, useState } from 'react';
import type { GlobalPayload, SeriesPoint } from '../api/market/global/route';

// Three market-snapshot cards on the Home hero (below the heading nav): total Market Cap,
// Fear & Greed, and Altcoin Season. Data comes from the server-side /api/market/global proxy
// (keyless CMC + alternative.me); polled every 60s to match the route's cache TTL.

function fmtMarketCap(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString()}`;
}

const fmtTooltipMc = (v: number): string =>
  v >= 1e12 ? `$${(v / 1e12).toFixed(3)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${v.toLocaleString()}`;

// Daily series → date only (no clock; the time-of-day would be meaningless noise).
const fmtTooltipDate = (t: number): string =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Market-cap sparkline with a hover crosshair + tooltip (follows the cursor to the nearest point).
// Colour is driven by `up` (the authoritative 24h % change), NOT the series endpoints — a 24h window
// can start above where it ends even on a net-up day, which would otherwise paint an up-day red.
// The line uses a stretched viewBox (preserveAspectRatio="none") with a non-scaling stroke so it
// stays crisp; the crosshair/dot/tooltip are positioned in % of the container so the stretch that
// distorts SVG user-units never touches them.
function Sparkline({ data, up }: { data: SeriesPoint[]; up: boolean }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null); // index of the hovered point

  if (data.length < 2) return null;

  const vals = data.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 480;
  const H = 90;
  const padY = 8;

  // x in %, y in SVG units (for the polyline) — and a parallel y in % (for the DOM dot).
  const xPct = (i: number) => (i / (data.length - 1)) * 100;
  const ySvg = (v: number) => H - padY - ((v - min) / span) * (H - padY * 2);
  const yPct = (v: number) => (ySvg(v) / H) * 100;

  const line = data.map((p, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${ySvg(p.v).toFixed(1)}`);
  const area = `0,${H} ${line.join(' ')} ${W},${H}`;
  const color = up ? 'var(--green)' : 'var(--red)';

  const onMove = (e: React.MouseEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (data.length - 1)));
  };

  const hp = hover != null ? data[hover] : null;
  const hx = hover != null ? xPct(hover) : 0;

  return (
    <div
      className="ov-mc-spark"
      ref={boxRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="ovMcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#ovMcFill)" stroke="none" />
        <polyline
          points={line.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {hp && (
        <>
          <div className="ov-mc-crosshair" style={{ left: `${hx}%` }} />
          <div className="ov-mc-dot" style={{ left: `${hx}%`, top: `${yPct(hp.v)}%`, background: color }} />
          <div
            className="ov-mc-tip"
            style={{ left: `${hx}%`, transform: `translateX(${hx > 60 ? '-100%' : '0'})` }}
          >
            <div className="ov-mc-tip-time">
              <span>{fmtTooltipDate(hp.t)}</span>
            </div>
            <div className="ov-mc-tip-price">
              <span className="ov-mc-tip-swatch" style={{ background: color }} />
              Market Cap: <strong>{fmtTooltipMc(hp.v)}</strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Fear & Greed dial: red (fear) → yellow → green (greed). Needle angle maps 0–100 to -90°..90°.
export default function GlobalStats() {
  const [data, setData] = useState<GlobalPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/market/global', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as GlobalPayload;
        if (alive) setData(json);
      } catch {
        /* fail soft — cards keep their last value */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const mc = data?.marketCap ?? null;
  const mcChange = data?.marketCapChange24h ?? null;
  const mcSeries = data?.marketCapSeries ?? [];
  const fg = data?.fearGreed ?? null;
  const alt = data?.altcoinSeason ?? null;

  // Fear & Greed needle: 0 → -90° (left/red), 100 → +90° (right/green).
  const fgAngle = fg ? (fg.value / 100) * 180 - 90 : -90;

  return (
    <div className="ov-gstats">
      {/* Market Cap */}
      <div className="ov-gcard">
        <div className="ov-gcard-head">
          Market Cap <span className="ov-gcard-chev">›</span>
        </div>
        <div className="ov-gcard-row">
          <span className="ov-gcard-value">{fmtMarketCap(mc)}</span>
          {mcChange != null && (
            <span className={'ov-gcard-change ' + (mcChange >= 0 ? 'up' : 'down')}>
              {mcChange >= 0 ? '▲' : '▼'} {Math.abs(mcChange).toFixed(2)}%
            </span>
          )}
        </div>
        <Sparkline data={mcSeries} up={(mcChange ?? 0) >= 0} />
      </div>

      {/* Fear & Greed */}
      <div className="ov-gcard ov-gcard--center">
        <div className="ov-gcard-explainer" role="tooltip">
          Scores market sentiment 0 (Extreme Fear) to 100 (Extreme Greed) from volatility, momentum,
          volume, social media and BTC dominance. Extreme fear can signal a buy; extreme greed, a top.
        </div>
        <div className="ov-gcard-head">
          Fear &amp; Greed <span className="ov-gcard-chev">›</span>
        </div>
        <div className="ov-gcard-fg">
          <svg viewBox="0 0 100 56" className="ov-fg-gauge" aria-hidden="true">
            <path d="M6 50 A44 44 0 0 1 22 16" fill="none" stroke="var(--red)" strokeWidth="7" strokeLinecap="round" />
            <path d="M26 13 A44 44 0 0 1 50 6" fill="none" stroke="#f0a020" strokeWidth="7" strokeLinecap="round" />
            <path d="M50 6 A44 44 0 0 1 74 13" fill="none" stroke="#e0c020" strokeWidth="7" strokeLinecap="round" />
            <path d="M78 16 A44 44 0 0 1 94 50" fill="none" stroke="var(--green)" strokeWidth="7" strokeLinecap="round" />
            <line
              x1="50"
              y1="50"
              x2={50 + 34 * Math.cos((fgAngle - 90) * (Math.PI / 180))}
              y2={50 + 34 * Math.sin((fgAngle - 90) * (Math.PI / 180))}
              stroke="var(--text)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="50" cy="50" r="4" fill="var(--text)" />
          </svg>
          <div className="ov-fg-info">
            <span className="ov-gcard-value">
              {fg ? fg.value : '—'}
            </span>
            <span className="ov-fg-label">{fg?.classification || ''}</span>
          </div>
        </div>
      </div>

      {/* Altcoin Season */}
      <div className="ov-gcard">
        <div className="ov-gcard-explainer" role="tooltip">
          Share of the top 100 coins that beat Bitcoin over 90 days. 75+ means Altcoin Season, 25 or
          below means Bitcoin Season.
        </div>
        <div className="ov-gcard-head">
          Altcoin Season <span className="ov-gcard-chev">›</span>
        </div>
        <div className="ov-gcard-row">
          <span className="ov-gcard-value">{alt != null ? alt : '—'}</span>
          <span className="ov-gcard-denom">/100</span>
        </div>
        <div className="ov-alt-bar">
          <div className="ov-alt-track" />
          {alt != null && <div className="ov-alt-knob" style={{ left: `${alt}%` }} />}
        </div>
        <div className="ov-alt-legend">
          <span>Bitcoin</span>
          <span>Altcoin</span>
        </div>
      </div>
    </div>
  );
}
