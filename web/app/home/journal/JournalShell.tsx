'use client';

import React, { useState } from 'react';
import NotesView from './NotesView';
import Sidebar, { type JournalView } from './Sidebar';
import TradingCalendar from './TradingCalendar';

// Sidebar + content, mirroring Reach's App.jsx layout (a flex row: fixed sidebar, main content that
// swaps on the active nav item). The sidebar owns the active view; New Trade always routes to the
// calendar, since that's where the trade modal lives.

export default function JournalShell() {
  const [view, setView] = useState<JournalView>('calendar');
  // Bumped on each New Trade click; TradingCalendar opens its modal on the change.
  const [newTradeSignal, setNewTradeSignal] = useState(0);

  const handleNewTrade = () => {
    setView('calendar');
    setNewTradeSignal((n) => n + 1);
  };

  return (
    <div className="journal-shell">
      <Sidebar view={view} onViewChange={setView} onNewTrade={handleNewTrade} />
      <div className="journal-content">
        {view === 'calendar' ? <TradingCalendar newTradeSignal={newTradeSignal} /> : <NotesView />}
      </div>
    </div>
  );
}
