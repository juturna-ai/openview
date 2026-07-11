'use client';

import { useEffect, useState } from 'react';

// ── The chart engine, wrapped as ONE client component ──
// The engine is the original 11k-line self-contained `index.html`, served verbatim from
// public/index.html. Its logic is NOT rewritten — this component simply mounts it in a
// full-viewport iframe and forwards the current query string (?embed=1&sym=&tf=…) so the
// engine reads the same params it always has.
//
// NOTE: the canonical mobile / multi-chart-grid / embed contract targets the RAW root
// document at `/` (the mobile WebView injects JS into the top frame and whitelists the
// engine origin — an iframe wrapper would break that). This /chart route is for in-app
// navigation from the site navbar only.
export default function ChartEngine() {
  // Resolve the iframe src once on the client, AFTER reading the arrival query string, then
  // render the iframe. Rendering it with a placeholder src first (e.g. "/") and updating in
  // an effect would load the 704KB engine twice whenever a query is present — so we hold the
  // frame back one tick instead. The engine needs `window` and can't SSR anyway.
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Preserve any query the user arrived with (e.g. /chart?sym=ETH-USD&tf=1h).
    setSrc('/' + window.location.search);
  }, []);

  if (src === null) return <div className="ov-chart-frame" aria-hidden />;
  return <iframe className="ov-chart-frame" src={src} title="Openview chart" />;
}
