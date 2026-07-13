'use client';

import React from 'react';
import type { Chain } from './chains';
import { getChainArt } from './chainIcons';

// Network avatar for the Wallet Tracker. Renders the chain's inline-SVG mark (chainIcons.ts) on the
// chain's own tint, and falls back to the letter badge this replaced for any chain without artwork —
// so adding a chain to CHAINS never blanks its rows, it just shows the initial until art is drawn.

export default function ChainIcon({ chain, size = 32 }: { chain: Chain; size?: number }) {
  const art = getChainArt(chain.id);

  return (
    <span
      className="wt-chain-badge"
      style={{
        // The artwork brings its own tinted disc; only the letter fallback needs the background.
        backgroundColor: art ? 'transparent' : chain.color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
      }}
    >
      {art ? (
        /* eslint-disable-next-line @next/next/no-img-element -- inline data-URI, no host to
           allow-list and nothing for next/image to optimise. */
        <img src={art} alt="" className="wt-chain-badge-img" width={size} height={size} />
      ) : (
        chain.label.charAt(0)
      )}
    </span>
  );
}
