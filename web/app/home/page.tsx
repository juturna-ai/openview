import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'OpenView' };

// Home landing — hero only. Folder tabs + heading nav come from home/layout.tsx.
export default function HomePage() {
  return (
    <main className="ov-home">
      <div className="ov-home-glow" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/freeview.png" alt="OpenView" className="ov-home-logo" />
      <h1 className="ov-home-brand">OpenView</h1>
      <p className="ov-home-tagline">the charting app</p>
    </main>
  );
}
