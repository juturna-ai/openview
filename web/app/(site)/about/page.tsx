import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'About — OpenView' };

export default function AboutPage() {
  return (
    <div className="ov-container ov-prose">
      <h2 className="ov-h2">About OpenView</h2>
      <p>
        OpenView is a free, keyless, TradingView-style crypto charting engine. It runs entirely
        client-side — market data is pulled directly from public exchange APIs, so there is no
        backend, no API key, and no paywall.
      </p>
      <p>
        The chart engine supports 15+ chart types, the full TradingView Technicals indicator set,
        a complete drawing-tool suite (trendlines, Fibonacci tools, Elliott waves), price and RSI
        alerts, and multi-chart layouts of up to 16 synchronized panels.
      </p>
      <p>
        The same engine powers the OpenView mobile app, which embeds it through a WebView and drives
        it natively for touch — pinch-zoom, drag-pan, and long-press crosshair.
      </p>
      <p>
        <a href="/">Open the live chart →</a>
      </p>
    </div>
  );
}
