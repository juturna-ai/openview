import type { Metadata } from 'next';
import JournalShell from './JournalShell';

export const metadata: Metadata = { title: 'Journal — Openview' };

export default function JournalPage() {
  return (
    <main className="ov-journal">
      <JournalShell />
    </main>
  );
}
