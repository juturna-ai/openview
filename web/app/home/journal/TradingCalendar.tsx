'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TradeModal from './TradeModal';
import { addTrade, loadTrades, type Trade } from './trades';

// Monthly trading calendar — a port of the Reach desktop app's TradingMonthView
// (src/components/Trading/TradingMonthView.jsx). Same layout and class names: four stat cards
// (Net P&L, Trade Win %, Day Win %, Daily Net Cumulative P&L) above an 8-column grid of
// 7 day columns + a weekly summary column. Trades live in localStorage; right-clicking a day cell
// opens a context menu to add one.
//
// Date math is hand-rolled rather than pulled from date-fns to keep the bundle dependency-free.
// Every date is treated as a *local* calendar date — 'YYYY-MM-DD' strings are parsed with an
// explicit T00:00:00 so they never shift a day across timezones.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM-DD' for a local date — not toISOString(), which converts to UTC and can shift a day. */
function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** The 6-week (42-day) grid covering `date`'s month, padded out to whole Sun–Sat weeks. */
function buildCalendarDays(date: Date): Date[] {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back up to Sunday

  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

  const days: Date[] = [];
  for (const d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

function formatPnl(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return (value >= 0 ? '+$' : '-$') + (abs / 1000).toFixed(1) + 'K';
  return (value >= 0 ? '+$' : '-$') + abs.toFixed(0);
}

function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const k = abs / 1000;
    return (value < 0 ? '-$' : '$') + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'K';
  }
  return (value < 0 ? '-$' : '$') + abs.toFixed(0);
}

/** Human-friendly axis ticks: a step from [1,2,2.5,5,10]×10ⁿ spanning min..max. */
function getNiceTicks(min: number, max: number, count: number) {
  const range = max - min || 1;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = ([1, 2, 2.5, 5, 10].find((s) => s * mag >= rawStep) ?? 10) * mag;
  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let t = start; t <= end + niceStep * 0.01; t += niceStep) {
    ticks.push(Math.round(t * 100) / 100);
  }
  return { ticks, min: start, max: end };
}

interface DayStats {
  pnl: number;
  count: number;
}

// Chart geometry (viewBox units).
const CHART_W = 300;
const CHART_H = 80;
const CHART_LEFT = 38;
const CHART_RIGHT = 8;
const CHART_TOP = 8;
const CHART_BOTTOM = 16;
const PLOT_W = CHART_W - CHART_LEFT - CHART_RIGHT;
const PLOT_H = CHART_H - CHART_TOP - CHART_BOTTOM;

/**
 * `newTradeSignal` is a counter, not a boolean: the sidebar's New Trade button bumps it, and each
 * bump opens the modal on the selected day. A boolean would need resetting after every open.
 */
export default function TradingCalendar({ newTradeSignal = 0 }: { newTradeSignal?: number }) {
  // `null` until mounted: the month depends on the client's clock, so rendering it during SSR
  // would risk a hydration mismatch if the server and browser sit on different days.
  const [today, setToday] = useState<Date | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  // Right-click menu: viewport coords + the day key it was opened on.
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  // The day key the add-trade modal is open for, or null when closed.
  const [modalKey, setModalKey] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    setToday(now);
    setDate(now);
    setTrades(loadTrades());

    // Keep the "today" highlight honest across midnight: a tab left open would otherwise keep
    // yesterday marked forever. The setter compares day keys so the once-a-minute tick only
    // re-renders on an actual rollover; the visibility listener catches backgrounded tabs, where
    // browsers throttle intervals well past a minute.
    const refreshToday = () =>
      setToday((prev) => {
        const next = new Date();
        return prev && toKey(prev) === toKey(next) ? prev : next;
      });
    const tick = setInterval(refreshToday, 60_000);
    document.addEventListener('visibilitychange', refreshToday);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', refreshToday);
    };
  }, []);

  // Sidebar "New Trade" — open on the selected day, falling back to today on the very first render.
  useEffect(() => {
    if (newTradeSignal > 0) setModalKey(toKey(date ?? new Date()));
    // `date` is deliberately not a dependency: this must fire on a new signal, not on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTradeSignal]);

  // Keep the calendar live if trades are written from another tab.
  useEffect(() => {
    const onStorage = () => setTrades(loadTrades());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Any click, scroll, or Escape anywhere dismisses the context menu.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = useCallback((e: React.MouseEvent, day: Date) => {
    e.preventDefault();
    setDate(day);
    setMenu({ x: e.clientX, y: e.clientY, key: toKey(day) });
  }, []);

  const handleSave = useCallback((trade: Omit<Trade, 'id'>) => {
    setTrades(addTrade(trade));
    setModalKey(null);
  }, []);

  const stats = useMemo(() => {
    if (!date) return null;

    const days = buildCalendarDays(date);

    // Group trades by day, then reduce each day to { pnl, count }. Open trades count toward
    // the trade count but contribute no P&L.
    const byDate: Record<string, Trade[]> = {};
    for (const t of trades) {
      (byDate[t.trade_date] ??= []).push(t);
    }
    const dailyPnl: Record<string, DayStats> = {};
    for (const [key, dayTrades] of Object.entries(byDate)) {
      const closed = dayTrades.filter((t) => !t.is_open);
      dailyPnl[key] = {
        pnl: closed.reduce((sum, t) => sum + (t.pnl || 0), 0),
        count: dayTrades.length,
      };
    }

    // Week rows — 7 days each, summarized into the 8th grid column.
    const weekRows = [];
    for (let i = 0; i < days.length; i += 7) {
      const slice = days.slice(i, i + 7);
      let weekPnl = 0;
      let tradingDays = 0;
      let tradeCount = 0;
      for (const d of slice) {
        const day = dailyPnl[toKey(d)];
        if (day) {
          weekPnl += day.pnl;
          tradingDays++;
          tradeCount += day.count;
        }
      }
      weekRows.push({ days: slice, weekPnl, tradingDays, tradeCount });
    }

    // Month aggregates — scoped to days that actually fall in this month, so the padding days
    // from the adjacent months visible in the grid never leak into the totals.
    const monthDays = Object.entries(dailyPnl).filter(([k]) => isSameMonth(parseKey(k), date));
    const monthPnl = monthDays.reduce((s, [, d]) => s + d.pnl, 0);
    const monthTradingDays = monthDays.length;
    const monthTradeCount = monthDays.reduce((s, [, d]) => s + d.count, 0);

    const monthTrades = trades.filter((t) => isSameMonth(parseKey(t.trade_date), date) && !t.is_open);
    const closedCount = monthTrades.length;
    const winningTrades = monthTrades.filter((t) => (t.pnl || 0) > 0).length;
    const losingTrades = monthTrades.filter((t) => (t.pnl || 0) < 0).length;
    const breakevenTrades = monthTrades.filter((t) => (t.pnl || 0) === 0).length;
    const tradeWinPct = closedCount > 0 ? (winningTrades / closedCount) * 100 : 0;

    const winningDays = monthDays.filter(([, d]) => d.pnl > 0).length;
    const losingDays = monthDays.filter(([, d]) => d.pnl < 0).length;
    const breakevenDays = monthDays.filter(([, d]) => d.pnl === 0).length;
    const dayWinPct = monthTradingDays > 0 ? (winningDays / monthTradingDays) * 100 : 0;

    // Running cumulative P&L, one point per trading day, in date order.
    const cumulative: { date: string; value: number }[] = [];
    let sum = 0;
    for (const [key, d] of [...monthDays].sort(([a], [b]) => a.localeCompare(b))) {
      sum += d.pnl;
      cumulative.push({ date: key, value: sum });
    }

    return {
      days,
      dailyPnl,
      weekRows,
      monthPnl,
      monthTradingDays,
      monthTradeCount,
      winningTrades,
      losingTrades,
      breakevenTrades,
      tradeWinPct,
      winningDays,
      losingDays,
      breakevenDays,
      dayWinPct,
      cumulative,
    };
  }, [date, trades]);

  // Project the cumulative series into SVG space. Needs 2+ points to draw a line.
  const chart = useMemo(() => {
    if (!stats || stats.cumulative.length < 2) return null;

    const values = stats.cumulative.map((d) => d.value);
    const nice = getNiceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
    const range = nice.max - nice.min || 1;
    const yOf = (v: number) => CHART_TOP + (1 - (v - nice.min) / range) * PLOT_H;

    const points = stats.cumulative.map((d, i) => ({
      x: CHART_LEFT + (i / (stats.cumulative.length - 1)) * PLOT_W,
      y: yOf(d.value),
      value: d.value,
    }));

    const zeroY = yOf(0);
    const path = `M${points.map((p) => `${p.x},${p.y}`).join(' L')}`;
    const fill = `${path} L${points[points.length - 1].x},${zeroY} L${points[0].x},${zeroY} Z`;

    // Up to 4 evenly spaced day-of-month labels, always including the last point.
    const maxLabels = Math.min(4, stats.cumulative.length);
    const step = Math.max(1, Math.floor((stats.cumulative.length - 1) / Math.max(1, maxLabels - 1)));
    const xLabels: { x: number; label: string }[] = [];
    for (let i = 0; i < stats.cumulative.length; i += step) {
      xLabels.push({ x: points[i].x, label: String(parseInt(stats.cumulative[i].date.split('-')[2], 10)) });
    }
    const last = stats.cumulative.length - 1;
    if (xLabels.length === 0 || xLabels[xLabels.length - 1].x !== points[last].x) {
      xLabels.push({ x: points[last].x, label: String(parseInt(stats.cumulative[last].date.split('-')[2], 10)) });
    }

    return {
      yTicks: nice.ticks.map((v) => ({ value: v, y: yOf(v) })),
      points,
      path,
      fill,
      xLabels,
      total: stats.cumulative[last].value,
    };
  }, [stats]);

  // Render nothing meaningful until the client clock is known (see the `today` state above).
  if (!date || !today || !stats) return <div className="trading-month-view" />;

  const shiftMonth = (delta: number) =>
    setDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));

  const pnlClass = stats.monthPnl >= 0 ? 'profit' : 'loss';

  return (
    <div className="trading-month-view">
      {/* Header: month nav, then the month name with the Month view chip beside it. Day/Week are
          not implemented, so the three-way toggle is gone — only Month remains. */}
      <div className="trading-header">
        <div className="trading-nav">
          <button className="btn-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            ‹
          </button>
          <button className="btn-today" onClick={() => setDate(new Date())}>
            Today
          </button>
          <button className="btn-nav" onClick={() => shiftMonth(1)} aria-label="Next month">
            ›
          </button>
          <div className="date-display">
            {MONTHS[date.getMonth()]} {date.getFullYear()}
          </div>
          <span className="view-mode-chip">Month</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="trading-stats-cards">
        <div className="trading-stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Net P&amp;L</span>
            <span className="stat-card-count">{stats.monthTradeCount}</span>
          </div>
          <div className={`stat-card-value ${pnlClass}`}>
            {stats.monthPnl >= 0 ? '' : '-'}$
            {Math.abs(stats.monthPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            <span className="stat-card-currency">USD</span>
          </div>
        </div>

        <div className="trading-stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Trade Win %</span>
          </div>
          <div className="stat-card-value">{stats.tradeWinPct.toFixed(2)}%</div>
          <div className="stat-gauge-bar">
            {stats.monthTradeCount === 0 ? (
              <div className="gauge-segment empty" style={{ flex: 1 }} />
            ) : (
              <>
                {stats.winningTrades > 0 && (
                  <div className="gauge-segment win" style={{ flex: stats.winningTrades }} />
                )}
                {stats.breakevenTrades > 0 && (
                  <div className="gauge-segment even" style={{ flex: stats.breakevenTrades }} />
                )}
                {stats.losingTrades > 0 && (
                  <div className="gauge-segment loss" style={{ flex: stats.losingTrades }} />
                )}
              </>
            )}
          </div>
          <div className="stat-gauge-labels">
            <span className="gauge-label win">{stats.winningTrades}</span>
            <span className="gauge-label even">{stats.breakevenTrades}</span>
            <span className="gauge-label loss">{stats.losingTrades}</span>
          </div>
        </div>

        <div className="trading-stat-card">
          <div className="stat-card-header">
            <span className="stat-card-label">Day Win %</span>
          </div>
          <div className="stat-card-value">{stats.dayWinPct.toFixed(2)}%</div>
          <div className="stat-gauge-bar">
            {stats.monthTradingDays === 0 ? (
              <div className="gauge-segment empty" style={{ flex: 1 }} />
            ) : (
              <>
                {stats.winningDays > 0 && (
                  <div className="gauge-segment win" style={{ flex: stats.winningDays }} />
                )}
                {stats.breakevenDays > 0 && (
                  <div className="gauge-segment even" style={{ flex: stats.breakevenDays }} />
                )}
                {stats.losingDays > 0 && (
                  <div className="gauge-segment loss" style={{ flex: stats.losingDays }} />
                )}
              </>
            )}
          </div>
          <div className="stat-gauge-labels">
            <span className="gauge-label win">{stats.winningDays}</span>
            <span className="gauge-label even">{stats.breakevenDays}</span>
            <span className="gauge-label loss">{stats.losingDays}</span>
          </div>
        </div>

        <div className="trading-stat-card stat-card-chart">
          <div className="stat-card-header">
            <span className="stat-card-label">Daily Net Cumulative P&amp;L</span>
            {chart && (
              <span className={`stat-card-chart-total ${pnlClass}`}>{formatPnl(chart.total)}</span>
            )}
          </div>
          {chart ? (
            <svg className="cumulative-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              {chart.yTicks.map((tick, i) => (
                <line
                  key={i}
                  x1={CHART_LEFT}
                  y1={tick.y}
                  x2={CHART_W - CHART_RIGHT}
                  y2={tick.y}
                  className={tick.value === 0 ? 'chart-grid-zero' : 'chart-grid-line'}
                />
              ))}
              <path d={chart.fill} className={`chart-area ${pnlClass}`} />
              <path d={chart.path} className={`chart-line ${pnlClass}`} />
              {chart.points.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="2"
                  className={`chart-dot ${p.value >= 0 ? 'profit' : 'loss'}`}
                />
              ))}
              {chart.yTicks.map((tick, i) => (
                <text
                  key={i}
                  x={CHART_LEFT - 4}
                  y={tick.y + 3}
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {formatAxisValue(tick.value)}
                </text>
              ))}
              {chart.xLabels.map((lbl, i) => (
                <text
                  key={i}
                  x={lbl.x}
                  y={CHART_H - 4}
                  textAnchor="middle"
                  className="chart-axis-label"
                >
                  {lbl.label}
                </text>
              ))}
            </svg>
          ) : (
            <div className="chart-empty">Not enough data</div>
          )}
        </div>
      </div>

      {/* 8-column grid: 7 day columns + the weekly summary column */}
      <div className="trading-unified-grid">
        {WEEKDAYS.map((d) => (
          <div key={d} className="calendar-header-cell">
            {d}
          </div>
        ))}
        <div className="trading-week-header-cell" />

        {stats.weekRows.map((week, wi) => (
          <React.Fragment key={wi}>
            {week.days.map((day) => {
              const dayData = stats.dailyPnl[toKey(day)];
              const currentMonth = isSameMonth(day, date);
              const cls = [
                'calendar-cell',
                'trading-cell',
                !currentMonth && 'other-month',
                isSameDay(day, date) && 'selected',
                isSameDay(day, today) && 'today',
                dayData && (dayData.pnl >= 0 ? 'trading-profit' : 'trading-loss'),
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div
                  key={toKey(day)}
                  className={cls}
                  onClick={() => setDate(day)}
                  onContextMenu={(e) => openMenu(e, day)}
                >
                  <div className="cell-date">{day.getDate()}</div>
                  {dayData && currentMonth && (
                    <div className="trading-cell-content">
                      <div className={`trading-cell-pnl ${dayData.pnl >= 0 ? 'profit' : 'loss'}`}>
                        {formatPnl(dayData.pnl)}
                      </div>
                      <div className="trading-cell-count">
                        {dayData.count} trade{dayData.count !== 1 ? 's' : ''}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div
              className={
                'trading-week-card ' +
                (week.tradingDays === 0 ? 'empty' : week.weekPnl >= 0 ? 'profit' : 'loss')
              }
            >
              <div className="trading-week-label">Week {wi + 1}</div>
              {week.tradingDays > 0 ? (
                <>
                  <div className={`trading-week-pnl ${week.weekPnl >= 0 ? 'profit' : 'loss'}`}>
                    {formatPnl(week.weekPnl)}
                  </div>
                  <div className="trading-week-meta">
                    {week.tradeCount} trade{week.tradeCount !== 1 ? 's' : ''} &middot;{' '}
                    {week.tradingDays} day{week.tradingDays !== 1 ? 's' : ''}
                  </div>
                </>
              ) : (
                <div className="trading-week-meta">No trades</div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Right-click menu. Positioned fixed at the cursor; nudged back inside the viewport so it
          never opens off-screen near the right/bottom edges. */}
      {menu && (
        <div
          className="calendar-context-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 60),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setModalKey(menu.key);
              setMenu(null);
            }}
          >
            + Add Trade
          </button>
        </div>
      )}

      {modalKey && (
        <TradeModal dateKey={modalKey} onSave={handleSave} onClose={() => setModalKey(null)} />
      )}
    </div>
  );
}
