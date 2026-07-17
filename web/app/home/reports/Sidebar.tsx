'use client';

import React, { useEffect, useState } from 'react';
import { useSidebarResize } from '../useSidebarResize';
import { Icon } from '../wallet/icons';

// Left sidebar for the Reports dashboard — same shell as the wallet's, but with no action button:
// brand header, nav, collapse toggle and live clock. Reuses the journal's .journal-sidebar /
// .nav-item styles so all three dashboards stay visually identical.

export type ReportsTab = 'dashboard' | 'daily' | 'weekly' | 'monthly';

// Icons are reused from the wallet's existing set — no new paths needed.
const NAV: { id: ReportsTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layers' },
  { id: 'daily', label: 'Daily', icon: 'bar-chart' },
  { id: 'weekly', label: 'Weekly', icon: 'trending-up' },
  { id: 'monthly', label: 'Monthly', icon: 'trophy' },
];

interface Props {
  view: ReportsTab;
  onViewChange: (v: ReportsTab) => void;
}

export default function Sidebar({ view, onViewChange }: Props) {
  // Held at null until mount so the server doesn't render a timestamp the client immediately
  // contradicts (hydration mismatch).
  const [now, setNow] = useState<Date | null>(null);
  const { asideRef, width, collapsed, dragging, toggleCollapsed, startResize, onHandleKeyDown } =
    useSidebarResize('openview:reports-sidebar');

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
        <span className="sidebar-brand-sub">the reports</span>
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
