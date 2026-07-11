'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Dark folder-tab bar (browser-tab style) shared by the site pages. Tabs: Home, Openview
// (the chart), Journal, Wallet. Mirrors the tab bar injected into the chart engine
// (index.html #ovTabs) so the two surfaces look identical. The active tab is derived from
// the current path; `active` may be passed to force a selection (e.g. the raw engine tab).
//
// Not rendered inside the chart engine or the phone app — the engine carries its own copy
// (hidden on embed), so the mobile WebView never shows tabs.
export default function OvTabs({ active }: { active?: 'home' | 'openview' | 'journal' | 'wallet' }) {
  const pathname = usePathname();
  const current =
    active ??
    (pathname?.startsWith('/home/journal')
      ? 'journal'
      : pathname?.startsWith('/home/wallet')
        ? 'wallet'
        : 'home');
  return (
    <div className="ov-tabs">
      <Link href="/home" className={'ov-tab' + (current === 'home' ? ' active' : '')}>Home</Link>
      {/* Plain anchor to `/index.html` (the raw chart engine). We target index.html — NOT `/` —
          because a bare `/` redirects to /home for browsers (see next.config.js); /index.html
          serves the engine directly with no redirect. */}
      <a href="/index.html" className={'ov-tab' + (current === 'openview' ? ' active' : '')}>Openview</a>
      <Link href="/home/journal" className={'ov-tab' + (current === 'journal' ? ' active' : '')}>Journal</Link>
      <Link href="/home/wallet" className={'ov-tab' + (current === 'wallet' ? ' active' : '')}>Wallet</Link>
      <Link href="/home" className="ov-tabs-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/freeview.png" alt="Openview" />
        <span>Openview</span>
      </Link>
    </div>
  );
}
