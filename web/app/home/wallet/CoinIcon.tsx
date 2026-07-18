'use client';

import React, { useState } from 'react';

// CoinMarketCap coin avatar. CMC serves a logo per coin id; long-tail and freshly-listed coins
// sometimes 404, so a failed load degrades to a coloured chip with the symbol's initial rather than
// a broken image. Ported from Reach's CoinIcon (GainersLosers.jsx).

const AVATAR_COLORS = [
  '#f7931a', '#627eea', '#26a17b', '#f3ba2f', '#2775ca', '#23292f',
  '#00ffa3', '#e84142', '#8247e5', '#0033ad', '#ff007a', '#375bd2',
];

export default function CoinIcon({
  symbol,
  thumb,
  size = 28,
}: {
  symbol: string;
  thumb?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  const color = AVATAR_COLORS[(symbol.charCodeAt(0) || 0) % AVATAR_COLORS.length];
  const showImg = !!thumb && !failed;

  return (
    <span
      className="gl-coin-icon"
      style={{
        backgroundColor: showImg ? 'transparent' : color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {!showImg && <span className="gl-coin-icon-char">{symbol.charAt(0)}</span>}
      {showImg && (
        /* eslint-disable-next-line @next/next/no-img-element -- remote CMC CDN logos keyed by coin
           id; next/image would need the host allow-listed and buys nothing for a 28px avatar. */
        <img
          src={thumb}
          alt=""
          className="gl-coin-icon-img"
          onError={() => setFailed(true)}
          loading="lazy"
          /* bin.bnbstatic.com (Binance-pair logo fallback) hotlink-blocks: 403 whenever a Referer
             header is present, 200 without one (curl-verified). CMC's s2 CDN doesn't care either
             way, so omitting the referer fixes the one host and costs the other nothing. */
          referrerPolicy="no-referrer"
        />
      )}
    </span>
  );
}
