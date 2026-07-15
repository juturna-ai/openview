'use client';

import dynamic from 'next/dynamic';
import React, { useState } from 'react';
import type { AssetRef } from '../wallet/AssetDetailView';
import AssetsSidebar, { type AssetsTab } from './AssetsSidebar';

// Sidebar + content for the Assets tab, mirroring WalletShell but without the wallet/tracker views
// or the Add Asset button. Leaderboards is the default board; Gainers & Losers is the second.
//
// Both boards and the asset-detail panel are code-split — the same components the wallet already
// lazy-loads, reused here so nothing new ships for the wallet's first paint.

const MoversView = dynamic(() => import('../wallet/MoversView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const AssetDetailView = dynamic(() => import('../wallet/AssetDetailView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});

export default function AssetsShell() {
  const [view, setView] = useState<AssetsTab>('leaderboards');
  // The asset whose detail page is open, or null for the board itself. Both boards hand back the
  // same shape.
  const [selected, setSelected] = useState<AssetRef | null>(null);

  // Leaving the board that opened a detail page has to close it too, or Back would return to a view
  // the sidebar has already navigated away from.
  const handleViewChange = (v: AssetsTab) => {
    setSelected(null);
    setView(v);
  };

  // The detail panel replaces the board rather than stacking on it, so the sidebar stays put and
  // Back restores exactly the board (and page, and sort) the user left.
  const board =
    view === 'leaderboards' ? (
      <MoversView key="lb" mode="leaderboards" onSelect={setSelected} />
    ) : (
      <MoversView key="mkt" mode="market" onSelect={setSelected} />
    );

  return (
    <div className="journal-shell">
      <AssetsSidebar view={view} onViewChange={handleViewChange} />
      <div className="journal-content">
        {/* Hidden rather than unmounted while a detail page is open: unmounting would throw away the
            board's page, sort and 30s-refreshed data, and Back would land on a reloading table. */}
        <div style={selected ? { display: 'none' } : undefined}>{board}</div>
        {selected && (
          <AssetDetailView asset={selected} onBack={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}
