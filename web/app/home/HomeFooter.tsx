'use client';

import { usePathname } from 'next/navigation';

// Site footer for the Home tab and its content pages. Suppressed on Journal, Wallet and Reports —
// those routes are full-height dashboards (sidebar + content), and a marketing footer under them
// just eats vertical space. Same pattern as HomeNav.
// `year` is passed in from the server layout rather than read from the client clock, so the
// rendered markup can't disagree with the server's across a New Year boundary.
export default function HomeFooter({ year }: { year: number }) {
  const pathname = usePathname();
  if (
    pathname?.startsWith('/home/journal') ||
    pathname?.startsWith('/home/wallet') ||
    pathname?.startsWith('/home/reports')
  )
    return null;
  return (
    <footer className="ov-footer">
      <div>© {year} Openview</div>
      <p className="ov-powered-by">
        Powered by{' '}
        <a href="https://juturna.io/" target="_blank" rel="noopener noreferrer">
          Juturna
        </a>
      </p>
      <div className="ov-footer-links">
        <a href="/home/privacy">Privacy</a>
      </div>
    </footer>
  );
}
