import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Openview — What it is' };

export default function OpenviewInfoPage() {
  return (
    <div className="ov-container ov-prose">
      <h2 className="ov-h2">Openview</h2>
      <p>
        Openview is a platform for looking at crypto markets the way professionals do — a fast,
        TradingView-style charting experience that runs entirely in your browser. No signup, no
        paywall, no API key.
      </p>
      <p>
        Chart any pair with 15+ chart types (candles, Heikin Ashi, Renko, Kagi, Point &amp; Figure,
        and more), layer on the full indicator suite (SMA/EMA, RSI, MACD, Bollinger Bands, ATR,
        VWAP, Stochastics and the TradingView Technicals set), and mark up price action with a
        complete drawing-tool kit — trendlines, Fibonacci tools, and Elliott waves.
      </p>
      <p>
        Set price and RSI alerts with sound, open up to 16 synchronized charts in TradingView-parity
        grid layouts, and build synthetic spread/ratio symbols. Market data streams straight from
        public exchange APIs, so there is no backend and nothing to sign up for.
      </p>
      <p>
        <a href="/">Open the live charts →</a>
      </p>
    </div>
  );
}
