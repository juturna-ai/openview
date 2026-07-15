'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useState } from 'react';
import Sidebar, { type WalletTab } from './Sidebar';
import WalletView from './WalletView';
import { useEmbedWallet } from './useEmbedWallet';

// Sidebar + content, mirroring JournalShell. The sidebar owns the active view; Add Asset always
// routes to the wallet, since that's where the modal lives. The leaderboards / gainers-losers
// boards moved out to the top-level Assets tab (/home/assets).
//
// The tracker view is code-split: it pulls in its own data layer and isn't needed for the wallet's
// first paint. But once the wallet has painted we warm its chunk on idle (see the effect below), so
// the first switch to it is instant instead of paying a chunk round-trip.

const WalletTrackerView = dynamic(() => import('./WalletTrackerView'), {
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
  // Bumped on each Add Asset click; WalletView opens its modal on the change.
  const [addAssetSignal, setAddAssetSignal] = useState(0);

  // Warm the tracker's code-split chunk while the browser is idle, after the wallet has painted, so
  // the first switch to it doesn't wait on a chunk download. Harmless if it never gets clicked.
  useEffect(() => {
    if (embed) return;
    const warm = () => void import('./WalletTrackerView');
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
    setView(v);
  };

  // Embedded in the phone app: wallet dashboard only, no sidebar/chrome. WalletView carries
  // its own Add Asset buttons (header + Assets table), so nothing is lost by dropping the sidebar.
  if (embed) {
    return (
      <div className="journal-shell wallet-embed">
        <div className="journal-content">
          <WalletView addAssetSignal={addAssetSignal} />
        </div>
      </div>
    );
  }

  return (
    <div className="journal-shell">
      <Sidebar view={view} onViewChange={handleViewChange} onAddAsset={handleAddAsset} />
      <div className="journal-content">
        {/* Both views stay mounted (the tracker once first visited); the inactive one is hidden with
            display:none rather than unmounted, so a switch neither re-fetches nor loses state. */}
        <div style={view === 'wallet' ? undefined : { display: 'none' }}>
          <WalletView addAssetSignal={addAssetSignal} />
        </div>
        {trackerMounted && (
          <div style={view === 'tracker' ? undefined : { display: 'none' }}>
            <WalletTrackerView />
          </div>
        )}
      </div>
    </div>
  );
}
