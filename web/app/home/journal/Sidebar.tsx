'use client';

import React, { useEffect, useState } from 'react';
import { useSidebarResize } from '../useSidebarResize';
import { Icon } from './icons';

// Left sidebar — a port of Reach's Sidebar (src/components/Layout/Sidebar.jsx), trimmed to the
// items in scope: the OPENVIEW brand header, the New Trade button, Calendar + Notes nav, and the
// live clock/date block. Reach's other nav items (Wallet, Trading View, Quant, …), the header's
// collapse chevron, the personal/trader mode toggle, and the "Customize" panel (which only
// configures a crypto/forex widget we don't have) are all deliberately omitted.

export type JournalView = 'calendar' | 'notes';

const NAV: { id: JournalView; label: string; icon: string }[] = [
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'notes', label: 'Notes', icon: 'sticky-note' },
];

interface Props {
  view: JournalView;
  onViewChange: (v: JournalView) => void;
  onNewTrade: () => void;
}

export default function Sidebar({ view, onViewChange, onNewTrade }: Props) {
  // Reach ticks a `new Date()` every second. Held at null until mount so the server doesn't render
  // a timestamp the client would immediately contradict (hydration mismatch).
  const [now, setNow] = useState<Date | null>(null);
  const { asideRef, width, collapsed, dragging, toggleCollapsed, startResize, onHandleKeyDown } =
    useSidebarResize('openview:journal-sidebar');

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
        <span className="sidebar-brand-sub">the journal</span>
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
        onClick={onNewTrade}
        title={collapsed ? 'New Trade' : undefined}
      >
        <Icon name="plus" size={18} />
        <span className="sidebar-label">New Trade</span>
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
