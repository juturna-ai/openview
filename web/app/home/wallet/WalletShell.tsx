'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useState } from 'react';
import type { AssetRef } from './AssetDetailView';
import Sidebar, { type WalletTab } from './Sidebar';
// Two wallet layouts: the browser keeps the original stat-card WalletViewWeb; the phone-app embed
// (?embed=wallet) gets the CoinMarketCap-style WalletView. Same `addAssetSignal` prop on both.
import WalletView from './WalletView';
import WalletViewWeb from './WalletViewWeb';
import { useEmbedWallet } from './useEmbedWallet';

// Sidebar + content, mirroring JournalShell. The sidebar owns the active view; Add Asset always
// routes to the wallet, since that's where the modal lives. The leaderboards / gainers-losers
// boards live here alongside the wallet and tracker.
//
// The tracker view is code-split: it pulls in its own data layer and isn't needed for the wallet's
// first paint. But once the wallet has painted we warm its chunk on idle (see the effect below), so
// the first switch to it is instant instead of paying a chunk round-trip.

const WalletTrackerView = dynamic(() => import('./WalletTrackerView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const ExplorerView = dynamic(() => import('./ExplorerView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const MoversView = dynamic(() => import('./MoversView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});
const AssetDetailView = dynamic(() => import('./AssetDetailView'), {
  loading: () => <p className="gl-page-loading">Loading…</p>,
});

export default function WalletShell() {
  // Phone-app embed (/home/wallet?embed=wallet): show ONLY the wallet dashboard — no sidebar,
  // no Add-Asset/Tracker nav. view is locked to 'wallet'.
  const embed = useEmbedWallet();
  const [view, setView] = useState<WalletTab>('wallet');
  // The tracker is mounted lazily on first visit, then kept mounted (hidden with display:none)
  // rather than unmounted — so switching Wallet ↔ Tracker is instant and neither view re-fetches
  // its data or loses its scroll/filter/panel state on every switch.
  const [trackerMounted, setTrackerMounted] = useState(false);
  // The Explorer is likewise mounted lazily on first visit then kept mounted, so switching back to it
  // keeps the last search on screen rather than repainting an empty hero.
  const [explorerMounted, setExplorerMounted] = useState(false);
  // The two boards are separate MoversView instances. Mounting both up-front meant each ran its own
  // 30s /api/market/cmc poll for the same data from first paint — two fetches and two 500-coin
  // renders to show one board. Each is mounted on first visit, then kept mounted like the others.
  const [leaderboardsMounted, setLeaderboardsMounted] = useState(false);
  const [moversMounted, setMoversMounted] = useState(false);
  // Bumped on each Add Asset click; WalletView opens its modal on the change.
  const [addAssetSignal, setAddAssetSignal] = useState(0);
  // The asset whose detail page is open (opened from a board), or null for the board itself.
  const [selected, setSelected] = useState<AssetRef | null>(null);

  // Warm the code-split chunks the user is most likely to open next, while the browser is idle and
  // after the wallet has painted, so the first switch doesn't wait on a chunk download. Harmless if
  // they never get clicked.
  useEffect(() => {
    if (embed) return;
    const warm = () => {
      void import('./WalletTrackerView');
      void import('./MoversView');
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm) : window.setTimeout(warm, 1500);
    return () => {
      const win = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (win.cancelIdleCallback) win.cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [embed]);

  const handleAddAsset = () => {
    setView('wallet');
    setAddAssetSignal((n) => n + 1);
  };

  const handleViewChange = (v: WalletTab) => {
    if (v === 'tracker') setTrackerMounted(true);
    if (v === 'explorer') setExplorerMounted(true);
    if (v === 'leaderboards') setLeaderboardsMounted(true);
    if (v === 'movers') setMoversMounted(true);
    // Leaving a board that opened a detail page has to close it too, or Back would return to a
    // view the sidebar has already navigated away from.
    setSelected(null);
    setView(v);
  };

  // Embedded in the phone app: wallet dashboard only, no sidebar/chrome. WalletView carries
  // its own Add Asset buttons (header + Assets table), so nothing is lost by dropping the sidebar.
  if (embed) {
    return (
      <div className="journal-shell wallet-embed">
        <div className="journal-content">
          {/* Phone app: the CoinMarketCap-style portfolio layout. */}
          <WalletView addAssetSignal={addAssetSignal} />
        </div>
      </div>
    );
  }

  return (
    <div className="journal-shell">
      <Sidebar view={view} onViewChange={handleViewChange} onAddAsset={handleAddAsset} />
      <div className="journal-content">
        {/* Every view is mounted on first visit and then kept mounted; the inactive ones are hidden
            with display:none rather than unmounted, so a switch neither re-fetches nor loses state.
            The boards are likewise hidden (not unmounted) while a detail page is open, so Back
            restores exactly the board, page and sort the user left. */}
        <div
          style={view === 'wallet' && !selected ? undefined : { display: 'none' }}
        >
          {/* Browser: the original stat-card wallet, not the phone/CMC layout. */}
          <WalletViewWeb addAssetSignal={addAssetSignal} />
        </div>
        {trackerMounted && (
          <div style={view === 'tracker' && !selected ? undefined : { display: 'none' }}>
            <WalletTrackerView />
          </div>
        )}
        {explorerMounted && (
          <div style={view === 'explorer' && !selected ? undefined : { display: 'none' }}>
            <ExplorerView />
          </div>
        )}
        {leaderboardsMounted && (
          <div style={view === 'leaderboards' && !selected ? undefined : { display: 'none' }}>
            <MoversView mode="leaderboards" onSelect={setSelected} />
          </div>
        )}
        {moversMounted && (
          <div style={view === 'movers' && !selected ? undefined : { display: 'none' }}>
            <MoversView mode="market" onSelect={setSelected} />
          </div>
        )}
        {selected && (
          <AssetDetailView asset={selected} onBack={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}
