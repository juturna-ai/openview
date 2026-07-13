import type { Metadata } from 'next';
import './globals.css';

const SITE_URL = 'https://openview.site';
const TITLE = 'Openview — Live Crypto Charts';
const DESCRIPTION = 'Free, keyless, TradingView-style crypto charts. No signup, no paywall.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  icons: {
    icon: [
      { url: '/assets/freeview.ico', type: 'image/x-icon' },
      { url: '/assets/freeview.png', type: 'image/png', sizes: '256x256' },
    ],
    apple: '/assets/freeview.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Openview',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/assets/banner.png',
        width: 1428,
        height: 798,
        type: 'image/png',
        alt: 'Openview — the charting platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/assets/banner.png'],
  },
};

// Root layout for the Next.js App Router pages (marketing site + /chart). The chart ENGINE
// itself is a standalone document served from public/index.html at `/` and does not pass
// through this layout.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
