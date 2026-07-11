'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

// TradingView-style top navbar shown on all marketing/site pages. The chart engine (served
// from public/index.html at `/`) has its own chrome and is NOT wrapped by this.
export default function Navbar() {
  const pathname = usePathname();
  return (
    <nav className="ov-nav">
      <Link href="/home" className="ov-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/freeview.png" alt="Openview" />
        <span>Open<span className="dot">View</span></span>
      </Link>
      <div className="ov-links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={'ov-link' + (pathname === l.href ? ' active' : '')}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <span className="ov-spacer" />
      {/* Launches the live chart engine (root document). Plain anchor, not <Link>, so it
          performs a real navigation to the static engine at `/` rather than a client-side
          route transition (there is no App Router page at `/`). */}
      <a href="/index.html" className="ov-cta">Open Chart</a>
    </nav>
  );
}
