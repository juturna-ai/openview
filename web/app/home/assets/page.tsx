import type { Metadata } from 'next';
import AssetsShell from './AssetsShell';

export const metadata: Metadata = { title: 'Assets — Openview' };

export default function AssetsPage() {
  return (
    <main className="ov-journal">
      <AssetsShell />
    </main>
  );
}
