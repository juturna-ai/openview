import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Openview' };

// Home landing — hero only. Folder tabs + heading nav come from home/layout.tsx.
export default function HomePage() {
  return (
    <main className="ov-home">
      <div className="ov-home-glow" />
      <h1 className="ov-home-brand">Openview</h1>
      <p className="ov-home-tagline">the charting platform</p>
    </main>
  );
}
