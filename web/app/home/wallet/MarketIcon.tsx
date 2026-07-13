'use client';

import React, { useState } from 'react';
import { chipColor, iconChain, type MarketClass } from './marketIcons';

// Leaderboard avatar for stocks, ETFs and commodities — the non-crypto classes, which arrive from
// /api/market/screener with no logo URL attached (crypto rows carry a CMC `thumb` and use CoinIcon).
//
// Same fallback shape as AssetIcon: the coloured letter chip is rendered *underneath* the <img>
// rather than instead of it, so a slow logo never flashes an empty circle — the letter shows through
// until the image paints over it. On error we advance through the CDN chain, and once it's exhausted
// the chip is simply what remains.

interface Props {
  symbol: string;
  cls: MarketClass;
  size?: number;
}

export default function MarketIcon({ symbol, cls, size = 28 }: Props) {
  const chain = iconChain(symbol, cls);
  const [step, setStep] = useState(0);

  const src = chain[step];
  const color = chipColor(symbol);

  return (
    <span
      className="gl-coin-icon"
      style={{
        // Commodity artwork is a full-bleed disc and brings its own background; a tint behind it
        // would just rim it. Stock/ETF logos are transparent marks that need the chip.
        backgroundColor: src && cls === 'commodities' ? 'transparent' : color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
    >
      <span className="gl-coin-icon-char">{symbol.charAt(0)}</span>
      {src && (
        /* eslint-disable-next-line @next/next/no-img-element -- remote logo CDNs across several
           hosts; next/image would need each one allow-listed and buys nothing for a 28px avatar. */
        <img
          src={src}
          alt=""
          className="gl-coin-icon-img"
          onError={() => setStep((s) => s + 1)}
          loading="lazy"
        />
      )}
    </span>
  );
}
