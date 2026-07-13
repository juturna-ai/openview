// Chain artwork for the Wallet Tracker — one inline SVG logo per network.
//
// Same reasoning as the commodity artwork in marketIcons.ts: these are data-URIs rather than remote
// CDN lookups. There are only ten of them, they're tiny, and a chain logo is *identity* — a wrong or
// missing one on a wallet card mislabels which network the balance is on, which is a correctness bug
// rather than a cosmetic one. No network, no lookup, nothing to mismatch, no extra round-trip.
//
// Each mark is the network's own recognisable glyph on a disc tinted with the chain colour already
// held in chains.ts (Chain.color), so the icons and the existing summary pills stay in sync.

/** Wraps chain artwork in a filled disc. `art` is SVG markup on a 0 0 100 100 canvas. */
function disc(bg: string, art: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="${bg}"/>${art}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The Ethereum octahedron — two stacked diamonds. Reused by every chain whose native token is ETH
 * (Arbitrum, Optimism, Base), tinted to that chain's colour so the rollups stay distinguishable from
 * mainnet at a glance while still reading as "this is an ETH balance".
 */
const ether = (bg: string) =>
  disc(
    bg,
    `<path d="M50 16 30 51l20 12 20-12z" fill="#fff" opacity="0.62"/>` +
      `<path d="M50 16 30 51l20-9z" fill="#fff"/>` +
      `<path d="M50 67 30 55l20 29 20-29z" fill="#fff" opacity="0.62"/>` +
      `<path d="M50 67 30 55l20 9z" fill="#fff"/>`,
  );

const CHAIN_ART: Record<string, string> = {
  ethereum: ether('#627eea'),
  arbitrum: ether('#28a0f0'),
  optimism: ether('#ff0420'),
  base: ether('#0052ff'),

  // BNB — the four-diamond cluster around a centre square.
  bsc: disc(
    '#f3ba2f',
    `<g fill="#fff">` +
      `<path d="M50 20l9 9-9 9-9-9z"/><path d="M29 41l9 9-9 9-9-9z"/>` +
      `<path d="M71 41l9 9-9 9-9-9z"/><path d="M50 62l9 9-9 9-9-9z"/>` +
      `<path d="M50 41l9 9-9 9-9-9z"/>` +
      `</g>`,
  ),

  // Polygon — the interlocking hexagon mark, drawn as two offset hex outlines.
  polygon: disc(
    '#8247e5',
    `<g fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round">` +
      `<path d="M36 33l14-8 14 8v16l-14 8-14-8z"/>` +
      `<path d="M36 51l14-8 14 8v16l-14 8-14-8z" opacity="0.55"/>` +
      `</g>`,
  ),

  // Avalanche — the stylised "A" peak.
  avalanche: disc(
    '#e84142',
    `<path d="M50 22l26 46H60L50 50 40 68H24z" fill="#fff"/>` +
      `<path d="M64 44l14 24H64l-7-12z" fill="#fff" opacity="0.85"/>`,
  ),

  // Solana — the three slanted bars.
  solana: disc(
    '#9945ff',
    `<g fill="#fff">` +
      `<path d="M30 34h44l-10 10H20z"/><path d="M20 50h44l10 10H30z" opacity="0.8"/>` +
      `<path d="M30 66h44l-10 10H20z" opacity="0.6"/>` +
      `</g>`,
  ),

  // Tron — the angular triangular mark.
  tron: disc(
    '#ef0027',
    `<path d="M22 28l56 10-30 40z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>` +
      `<path d="M22 28l26 50 8-40z" fill="#fff" opacity="0.85"/>`,
  ),

  // NEAR — the parallelogram "N".
  near: disc(
    '#1c1c1c',
    `<path d="M28 26h10l24 32V26h10v48H62L38 42v32H28z" fill="#fff"/>`,
  ),
};

/** Inline artwork for a chain id, or null if uncataloged (caller falls back to the letter badge). */
export function getChainArt(chainId: string): string | null {
  return CHAIN_ART[chainId] ?? null;
}
