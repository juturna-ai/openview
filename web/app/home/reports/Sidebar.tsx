'use client';

import React, { useEffect, useState } from 'react';
import { useSidebarResize } from '../useSidebarResize';
import { Icon } from '../wallet/icons';

// Left sidebar for the Reports dashboard — same shell as the wallet's, but with no action button
// and no nav list: only the brand header, the collapse toggle and the live clock. Reuses the
// journal's .journal-sidebar styles so all three dashboards stay visually identical.

export default function Sidebar() {
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
