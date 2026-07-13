'use client';

import dynamic from 'next/dynamic';
import React, { useState } from 'react';
import Sidebar, { type WalletTab } from './Sidebar';
import WalletView from './WalletView';

// Sidebar + content, mirroring JournalShell. The sidebar owns the active view; Add Asset always
// routes to the wallet, since that's where the modal lives.
//
// The other two views are code-split: each pulls in its own data layer and neither is needed for
// the wallet's first paint.

const MoversView = dynamic(() => import('./MoversView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const WalletTrackerView = dynamic(() => import('./WalletTrackerView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});

export default function WalletShell() {
  const [view, setView] = useState<WalletTab>('wallet');
  // Bumped on each Add Asset click; WalletView opens its modal on the change.
  const [addAssetSignal, setAddAssetSignal] = useState(0);

  const handleAddAsset = () => {
    setView('wallet');
    setAddAssetSignal((n) => n + 1);
  };

  return (
    <div className="journal-shell">
      <Sidebar view={view} onViewChange={setView} onAddAsset={handleAddAsset} />
      <div className="journal-content">
        {view === 'wallet' && <WalletView addAssetSignal={addAssetSignal} />}
        {view === 'movers' && <MoversView />}
        {view === 'tracker' && <WalletTrackerView />}
      </div>
    </div>
  );
}
