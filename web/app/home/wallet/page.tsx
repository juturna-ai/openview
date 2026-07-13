import type { Metadata } from 'next';
import WalletShell from './WalletShell';

export const metadata: Metadata = { title: 'Wallet — Openview' };

export default function WalletPage() {
  return (
    <main className="ov-journal">
      <WalletShell />
    </main>
  );
}
