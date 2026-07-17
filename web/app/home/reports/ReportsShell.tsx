'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useState } from 'react';
import Sidebar, { type ReportsTab } from './Sidebar';

// Sidebar + content, mirroring WalletShell. The sidebar owns the active view.
//
// Same mounting discipline as the wallet: each period view is mounted lazily on first visit and then
// kept mounted (hidden with display:none) rather than unmounted, so switching tabs is instant and no
// view re-fetches its report or loses scroll position. That matters more here than on the wallet —
// a report miss costs a CMC listing, a Binance sweep and an LLM call, so re-fetching on every tab
// switch would be genuinely expensive rather than merely wasteful.

const PeriodView = dynamic(() => import('./PeriodView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const DashboardView = dynamic(() => import('./DashboardView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});

export default function ReportsShell() {
  const [view, setView] = useState<ReportsTab>('dashboard');
  // Dashboard is the landing tab, so it mounts with the shell; the period views wait for a visit.
  const [dailyMounted, setDailyMounted] = useState(false);
  const [weeklyMounted, setWeeklyMounted] = useState(false);
  const [monthlyMounted, setMonthlyMounted] = useState(false);

  // Warm the PeriodView chunk while the browser is idle — Daily is the most likely next click, and
  // the chunk download shouldn't sit on the critical path of that click.
  useEffect(() => {
    const warm = () => {
      void import('./PeriodView');
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm) : window.setTimeout(warm, 1500);
    return () => {
      const win = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (win.cancelIdleCallback) win.cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, []);

  const handleViewChange = (v: ReportsTab) => {
    if (v === 'daily') setDailyMounted(true);
    if (v === 'weekly') setWeeklyMounted(true);
    if (v === 'monthly') setMonthlyMounted(true);
    setView(v);
  };

  return (
    <div className="journal-shell">
      <Sidebar view={view} onViewChange={handleViewChange} />
      <div className="journal-content">
        <div style={view === 'dashboard' ? undefined : { display: 'none' }}>
          <DashboardView onOpenPeriod={handleViewChange} />
        </div>
        {dailyMounted && (
          <div style={view === 'daily' ? undefined : { display: 'none' }}>
            <PeriodView period="daily" />
          </div>
        )}
        {weeklyMounted && (
          <div style={view === 'weekly' ? undefined : { display: 'none' }}>
            <PeriodView period="weekly" />
          </div>
        )}
        {monthlyMounted && (
          <div style={view === 'monthly' ? undefined : { display: 'none' }}>
            <PeriodView period="monthly" />
          </div>
        )}
      </div>
    </div>
  );
}
