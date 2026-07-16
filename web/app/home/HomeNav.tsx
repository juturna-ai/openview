'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Heading nav shown INSIDE the Home tab (below the folder-tab bar). Not folder tabs — a
// simple centered link row. "Openview" here is the platform DESCRIPTION page (/home/openview),
// distinct from the chart engine (the folder-tab "OpenView" that opens `/`).
const LINKS = [
  { href: '/home', label: 'Home' },
  { href: '/home/openview', label: 'Openview' },
  { href: '/home/app', label: 'APP' },
  { href: '/home/docs', label: 'Docs' },
  { href: '/home/about', label: 'About us' },
];

export default function HomeNav() {
  const pathname = usePathname();
  // Journal / Wallet / Reports are standalone dashboards — no heading nav row.
  if (
    pathname?.startsWith('/home/journal') ||
    pathname?.startsWith('/home/wallet') ||
    pathname?.startsWith('/home/reports')
  )
    return null;
  return (
    <nav className="ov-hnav">
      <div className="ov-hnav-links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={'ov-hnav-link' + (pathname === l.href ? ' active' : '')}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
