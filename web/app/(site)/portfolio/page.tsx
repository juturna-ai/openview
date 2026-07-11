import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Portfolio — Openview' };

const ITEMS = [
  { title: 'Charting Engine', desc: 'A single-file, dependency-light charting engine: 15+ chart types, indicators, drawings, alerts, and multi-chart layouts.' },
  { title: 'Mobile App', desc: 'Expo / React Native app that reuses the web engine through a WebView, with offline-first storage and optional Supabase sync.' },
  { title: 'Indicator Suite', desc: 'A full TradingView-parity Technicals set plus a lightweight PineScript-style custom scripting layer.' },
  { title: 'Drawing Tools', desc: 'Trendlines, Fibonacci retracement/extension, Elliott wave tooling, and per-symbol persistence.' },
];

export default function PortfolioPage() {
  return (
    <div className="ov-container">
      <h2 className="ov-h2">Portfolio</h2>
      <div className="ov-grid">
        {ITEMS.map((it) => (
          <div className="ov-card" key={it.title}>
            <h3>{it.title}</h3>
            <p>{it.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
