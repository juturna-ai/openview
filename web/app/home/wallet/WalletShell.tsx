'use client';

import dynamic from 'next/dynamic';
import React, { useState } from 'react';
import type { AssetRef } from './AssetDetailView';
import Sidebar, { type WalletTab } from './Sidebar';
import WalletView from './WalletView';

// Sidebar + content, mirroring JournalShell. The sidebar owns the active view; Add Asset always
// routes to the wallet, since that's where the modal lives.
//
// The other views are code-split: each pulls in its own data layer and none is needed for the
// wallet's first paint. The asset detail panel is the strongest case for it — nobody sees it until
// they click a leaderboard row, so its chart code shouldn't ship with the shell.

const MoversView = dynamic(() => import('./MoversView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const WalletTrackerView = dynamic(() => import('./WalletTrackerView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const AssetDetailView = dynamic(() => import('./AssetDetailView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});

export default function WalletShell() {
  const [view, setView] = useState<WalletTab>('wallet');
  // Bumped on each Add Asset click; WalletView opens its modal on the change.
  const [addAssetSignal, setAddAssetSignal] = useState(0);
  // The asset whose detail page is open, or null for the board itself. Any board can set it — the
  // leaderboards, gainers/losers and sentiment tables all hand back the same shape.
  const [selected, setSelected] = useState<AssetRef | null>(null);

  const handleAddAsset = () => {
    setView('wallet');
    setSelected(null);
    setAddAssetSignal((n) => n + 1);
  };

  // Leaving the board that opened a detail page has to close it too, or Back would return to a view
  // the sidebar has already navigated away from.
  const handleViewChange = (v: WalletTab) => {
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

  const isBoard = view === 'leaderboards' || view === 'movers';

  return (
    <div className="journal-shell">
      <Sidebar view={view} onViewChange={handleViewChange} onAddAsset={handleAddAsset} />
      <div className="journal-content">
        {view === 'wallet' && <WalletView addAssetSignal={addAssetSignal} />}
        {/* Same component, two sidebar destinations: Leaderboards renders it standalone (no tab
            row), Gainers & Losers renders the market tabs. Keyed so switching between the two
            remounts rather than carrying the other's tab state across.

            Hidden rather than unmounted while a detail page is open: unmounting would throw away the
            board's page, sort and 30s-refreshed data, and Back would land on a reloading table. */}
        {isBoard && (
          <div style={selected ? { display: 'none' } : undefined}>{board}</div>
        )}
        {isBoard && selected && (
          <AssetDetailView asset={selected} onBack={() => setSelected(null)} />
        )}
        {view === 'tracker' && <WalletTrackerView />}
      </div>
    </div>
  );
}
