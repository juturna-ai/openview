import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Openview — Live Crypto Charts',
  description: 'Free, keyless, TradingView-style crypto charts. No signup, no paywall.',
  icons: {
    icon: [
      { url: '/assets/freeview.ico', type: 'image/x-icon' },
      { url: '/assets/freeview.png', type: 'image/png', sizes: '256x256' },
    ],
    apple: '/assets/freeview.png',
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
