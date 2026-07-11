import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'App — Openview' };

export default function AppPage() {
  return (
    <div className="ov-container ov-prose">
      <h2 className="ov-h2">The Openview App</h2>
      <p>
        Openview also comes as a mobile app for iOS and Android. It runs the exact same charting
        engine as the web — the full chart, indicators, drawings, and alerts — tuned for touch, so
        pinch-zoom, drag-pan, and long-press crosshair all feel native.
      </p>
      <p>
        The app is offline-first: it works fully on its own, and optional cross-device sync,
        anonymous sign-in, and closed-app price alerts light up when configured. Your drawings and
        alerts are saved per symbol so they follow you between sessions.
      </p>
      <p>
        Switch symbols and timeframes, add indicators, and set alerts right from your phone — the
        same charts you use on the desktop, in your pocket.
      </p>
    </div>
  );
}
