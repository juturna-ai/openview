import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'OpenView' };

// Home landing — hero only. Folder tabs + heading nav come from home/layout.tsx.
export default function HomePage() {
  return (
    <main className="ov-home">
      <section className="ov-home-hero">
        <h1>OpenView</h1>
      </section>
    </main>
  );
}
