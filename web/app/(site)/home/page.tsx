import Link from 'next/link';

// Title/description inherit from the root layout (app/layout.tsx) — the landing page uses
// the site-wide defaults, so no page-level metadata override is needed here.
export default function HomePage() {
  return (
    <>
      <section className="ov-hero">
        <h1>Professional crypto charts.<br />Free, keyless, instant.</h1>
        <p>
          A TradingView-style charting engine for crypto — 15+ chart types, full indicator
          suite, drawing tools, alerts, and multi-chart layouts. No signup. No paywall. No API key.
        </p>
        <div className="ov-hero-actions">
          {/* Plain anchor: `/` is the raw static engine, not an App Router page. */}
          <a href="/" className="ov-btn primary">Open the Chart</a>
          {/* next/link: `/about` IS an App Router page → client-side transition + prefetch. */}
          <Link href="/about" className="ov-btn">Learn more</Link>
        </div>
      </section>

      <section className="ov-container">
        <div className="ov-grid">
          <div className="ov-card">
            <h3>15+ chart types</h3>
            <p>Candles, Heikin Ashi, Renko, Kagi, Point &amp; Figure, Line Break, and more — all rendered client-side.</p>
          </div>
          <div className="ov-card">
            <h3>Full indicator suite</h3>
            <p>SMA/EMA, RSI, MACD, Bollinger Bands, ATR, VWAP, Stochastics and the TradingView Technicals set.</p>
          </div>
          <div className="ov-card">
            <h3>Drawing tools &amp; alerts</h3>
            <p>Trendlines, Fib tools, Elliott waves, price &amp; RSI alerts with sound — persisted per symbol.</p>
          </div>
          <div className="ov-card">
            <h3>Multi-chart layouts</h3>
            <p>Up to 16 synchronized panels in TradingView-parity grid layouts, each a full chart instance.</p>
          </div>
          <div className="ov-card">
            <h3>Mobile app</h3>
            <p>The same engine drives the OpenView mobile app via WebView — touch-optimized pinch, pan, and crosshair.</p>
          </div>
          <div className="ov-card">
            <h3>Keyless &amp; private</h3>
            <p>Market data comes straight from public exchange APIs. No account, no tracking, no backend.</p>
          </div>
        </div>
      </section>
    </>
  );
}
