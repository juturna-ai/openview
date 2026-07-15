'use client';

import { useEffect, useState } from 'react';

// True when the wallet dashboard is embedded in the phone app's WebView
// (/home/wallet?embed=wallet). In that mode the site chrome (OvTabs folder bar) and the
// wallet sidebar (Add Asset + Leaderboards/Gainers & Losers/Wallet Tracker nav) are hidden
// so ONLY the wallet dashboard shows, sized for the phone frame.
//
// Read from window.location rather than useSearchParams so no Suspense boundary / CSR bailout
// is needed; starts false on the server + first client paint, flips true after mount. Callers
// hide chrome on the flag, so the brief first-paint flash is chrome→no-chrome, never the reverse.
export function useEmbedWallet(): boolean {
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    try {
      setEmbed(new URLSearchParams(window.location.search).get('embed') === 'wallet');
    } catch {
      /* no window (SSR) — stays false */
    }
  }, []);
  return embed;
}
