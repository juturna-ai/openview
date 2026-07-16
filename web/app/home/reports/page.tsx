import type { Metadata } from 'next';
import ReportsShell from './ReportsShell';

export const metadata: Metadata = { title: 'Reports — Openview' };

export default function ReportsPage() {
  return (
    <main className="ov-journal">
      <ReportsShell />
    </main>
  );
}
