'use client';

import React, { useEffect, useState } from 'react';
import { useSidebarResize } from '../useSidebarResize';
import { Icon } from './icons';

// Left sidebar — same shape as the journal's (New action button, nav, live clock), scoped to the
// wallet's three views. Reuses the journal's .journal-sidebar / .nav-item styles so the two
// dashboards stay visually identical, including the resize handle and collapse toggle.

export type WalletTab = 'wallet' | 'tracker' | 'leaderboards' | 'movers';

const NAV: { id: WalletTab; label: string; icon: string }[] = [
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'tracker', label: 'Wallet Tracker', icon: 'radar' },
  { id: 'leaderboards', label: 'Leaderboards', icon: 'trophy' },
  { id: 'movers', label: 'Gainers & Losers', icon: 'bar-chart' },
];

interface Props {
  view: WalletTab;
  onViewChange: (v: WalletTab) => void;
  onAddAsset: () => void;
}

export default function Sidebar({ view, onViewChange, onAddAsset }: Props) {
  // Held at null until mount so the server doesn't render a timestamp the client immediately
  // contradicts (hydration mismatch).
  const [now, setNow] = useState<Date | null>(null);
  const { asideRef, width, collapsed, dragging, toggleCollapsed, startResize, onHandleKeyDown } =
    useSidebarResize('openview:wallet-sidebar');

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside
      ref={asideRef}
      className={
        'journal-sidebar' + (collapsed ? ' collapsed' : '') + (dragging ? ' resizing' : '')
      }
      style={collapsed ? undefined : { width }}
    >
      <div className="sidebar-brand">
        <span className="sidebar-brand-name">Openview</span>
        <span className="sidebar-brand-sub">the wallet</span>
      </div>

      <button
        className="sidebar-collapse-btn"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
      </button>

      <button
        className="btn-add-trade"
        onClick={onAddAsset}
        title={collapsed ? 'Add Asset' : undefined}
      >
        <Icon name="plus" size={18} />
        <span className="sidebar-label">Add Asset</span>
      </button>

      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={'nav-item' + (view === item.id ? ' active' : '')}
            onClick={() => onViewChange(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={20} />
            </span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-clock">
        {now && (
          <>
            <div className="clock-time">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="clock-details">
              <span className="clock-month">{now.toLocaleDateString([], { month: 'long' })}</span>
              <span className="clock-weekday">
                {now.toLocaleDateString([], { weekday: 'long' })}
              </span>
            </div>
            <div className="clock-today">
              <span className="today-badge">{now.getDate()}</span>
              <span className="clock-year">{now.getFullYear()}</span>
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div
          className="sidebar-resize-handle"
          onPointerDown={startResize}
          onKeyDown={onHandleKeyDown}
          onDoubleClick={toggleCollapsed}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
        />
      )}
    </aside>
  );
}
