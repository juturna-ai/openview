'use client';

import React, { useState } from 'react';
import {
  type AssetType,
  getAssetColor,
  getCryptoFallbackUrl,
  getIconChar,
  getLogoUrl,
  getMetalFallbackUrl,
  hasLogoOverride,
  needsLightChip,
} from './assets';

// Asset avatar with Reach's fallback chain: try the logo CDN, fall back once (crypto only) to a
// second CDN, and if that fails too, show a coloured chip with the asset's glyph. The chip is
// rendered underneath the <img> rather than instead of it, so a slow-loading logo never flashes
// empty — the letter shows through until the image paints over it.
//
// Flags and metal coins are "overrides": real artwork that shouldn't sit on a tinted chip, so those
// render transparent with no glyph behind them.

interface Props {
  symbol: string;
  assetType: AssetType;
  size?: number;
}

export default function AssetIcon({ symbol, assetType, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // React reuses this instance when the parent re-renders with a different asset
  // (e.g. the Best/Worst Performer card changing between polls) — reset the error
  // chain so the new symbol gets its own shot at loading, render-time per React docs.
  const [prevAsset, setPrevAsset] = useState(`${symbol}|${assetType}`);
  if (prevAsset !== `${symbol}|${assetType}`) {
    setPrevAsset(`${symbol}|${assetType}`);
    setFailed(false);
    setTriedFallback(false);
    setLoaded(false);
  }

  const isOverride = hasLogoOverride(symbol, assetType);
  // Dark-glyph-on-transparent logos (ADA, WLD, 1INCH…) vanish over a dark tint — back those with a
  // light disc instead, mirroring the chart engine's `.on-light` treatment.
  const lightChip = needsLightChip(symbol, assetType);
  const color = lightChip ? '#f5f6fa' : getAssetColor(symbol);
  const char = getIconChar(symbol);

  const primary = getLogoUrl(symbol, assetType);
  const fallback = assetType === 'metal' ? getMetalFallbackUrl(symbol) : getCryptoFallbackUrl(symbol);
  const src = triedFallback ? fallback : primary;
  const showImg = !!src && !failed;

  const handleError = () => {
    // CoinCap 404s a fair number of long-tail tickers; jsdelivr covers some of them. A metal's .gif
    // falls back to its inline-SVG coin, so a missing sprite never leaves a blank chip.
    if ((assetType === 'crypto' || assetType === 'metal') && !triedFallback && fallback) {
      setTriedFallback(true);
      return;
    }
    setFailed(true);
  };

  const cls = [
    'wallet-asset-icon',
    isOverride ? 'logo-override' : '',
    assetType === 'currency' ? 'flag-icon' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Only the .gif sprite wants `pixelated`; the SVG coin it falls back to scales cleanly and would
  // just look jagged with it.
  const imgClass =
    assetType === 'currency'
      ? 'wallet-icon-img-flag'
      : assetType === 'metal' && !triedFallback
        ? 'wallet-icon-img-metal'
        : 'wallet-icon-img';

  return (
    <span
      className={cls}
      style={{
        backgroundColor: isOverride ? 'transparent' : color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {/* The glyph waits under the image until it paints, then unmounts — a transparent-background
          logo must not have a stray letter showing through it. Dark text on the light chip. */}
      {!isOverride && !loaded && (
        <span className="wallet-icon-char" style={lightChip ? { color: '#1b1f27' } : undefined}>
          {char}
        </span>
      )}
      {showImg && (
        /* eslint-disable-next-line @next/next/no-img-element -- remote CDN logos across many hosts;
           next/image would need every host in next.config and buys nothing for a 28px avatar. */
        <img
          src={src}
          alt=""
          className={imgClass}
          onError={handleError}
          onLoad={() => setLoaded(true)}
          loading="lazy"
        />
      )}
    </span>
  );
}
