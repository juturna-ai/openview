import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Journal — Openview' };

export default function JournalPage() {
  return (
    <main className="ov-home">
      <div className="ov-home-glow" />
      <h1 className="ov-home-brand ov-soon">Coming soon</h1>
    </main>
  );
}
