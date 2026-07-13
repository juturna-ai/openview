// Leaderboard icon resolution for the non-crypto asset classes: stocks, ETFs and commodities.
//
// The crypto board already has real artwork — CoinMarketCap hands us a per-coin logo URL on every
// row (`thumb`). Nothing equivalent exists for the other three classes, so this module resolves an
// icon from the ticker alone. Each class needs a different strategy:
//
//   Stocks   500 rows straight off Nasdaq's screener, so a hand-written domain map is hopeless —
//            it would cover the megacaps and leave a lettered chip on the long tail. Instead both
//            sources here are keyed by *ticker*, so they cover the whole universe for free.
//
//   ETFs     Same CDNs. Verified against all 40 in the screener's curated list — every one resolves,
//            including the issuer marks (iShares, Vanguard, SPDR, Invesco).
//
//   Commodities  MUST NOT touch a stock CDN. A futures root collides with a real equity ticker far
//            too often, and the CDN answers with the *company's* logo rather than a miss: CL is
//            Colgate-Palmolive (not Crude Oil), KC is Kraft-Heinz (not Coffee), LE is Lennar (not
//            Live Cattle), SB and BZ likewise. A miss degrades to a letter chip and is merely ugly;
//            a wrong-but-confident logo is a correctness bug. So every commodity gets hand-drawn
//            inline-SVG artwork below — no network, no lookup, nothing to mismatch.
//
// Both CDNs are keyless and undocumented, so the component walks them as a chain: primary → fallback
// → coloured letter chip. A dead host degrades, it never blanks the row.

export type MarketClass = 'stocks' | 'etfs' | 'commodities';

/* ── Commodity artwork ──────────────────────────────────────────────────────────────────────────
 *
 * Inline SVG data-URIs: each commodity draws its own thing (a barrel, a flame, an ear of corn) on a
 * tinted disc. Data-URIs rather than files in /public because there are only 16 and they're tiny —
 * this keeps them a pure import with no extra HTTP round-trip per row.
 */

/** Wraps a glyph in a filled disc. `art` is SVG markup on a 0 0 100 100 canvas. */
function disc(bg: string, art: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="50" fill="${bg}"/>${art}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A metal coin: concentric rings with the element symbol struck into the face. */
function coin(face: string, rim: string, ink: string, text: string): string {
  return disc(
    face,
    `<circle cx="50" cy="50" r="40" fill="none" stroke="${rim}" stroke-width="3"/>` +
      `<circle cx="38" cy="34" r="18" fill="#fff" opacity="0.22"/>` +
      `<text x="50" y="62" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30"` +
      ` font-weight="700" fill="${ink}">${text}</text>`,
  );
}

/** An oil barrel — the two energy liquids differ only in tint. */
const barrel = (bg: string, body: string, band: string) =>
  disc(
    bg,
    `<rect x="30" y="24" width="40" height="52" rx="6" fill="${body}"/>` +
      `<rect x="30" y="36" width="40" height="6" fill="${band}"/>` +
      `<rect x="30" y="58" width="40" height="6" fill="${band}"/>` +
      `<ellipse cx="50" cy="24" rx="20" ry="6" fill="${band}"/>`,
  );

/** A grain stalk — corn, wheat and soy are the same silhouette in different colours. */
const grain = (bg: string, ink: string) =>
  disc(
    bg,
    `<path d="M50 82V30" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M50 40c-14 0-20-8-20-16 10 0 20 6 20 16zM50 40c14 0 20-8 20-16-10 0-20 6-20 16z" fill="${ink}"/>` +
      `<path d="M50 58c-14 0-20-8-20-16 10 0 20 6 20 16zM50 58c14 0 20-8 20-16-10 0-20 6-20 16z" fill="${ink}" opacity="0.75"/>`,
  );

const COMMODITY_ART: Record<string, string> = {
  // Precious metals — struck coins.
  XAU: coin('#f2c14a', '#c99a24', '#6b4c00', 'Au'),
  XAG: coin('#cfd3d8', '#9aa0a8', '#43484f', 'Ag'),
  XPT: coin('#dfe3ec', '#a8b0c2', '#3a4256', 'Pt'),
  XPD: coin('#c3c9d6', '#949cae', '#39404e', 'Pd'),

  // Industrial metal — a copper ingot.
  HG: disc(
    '#b06a3b',
    `<path d="M24 62l10-20h32l10 20z" fill="#e08a52"/>` +
      `<path d="M24 62h52v10H24z" fill="#8f4f28"/>` +
      `<path d="M34 42h32l-4 8H38z" fill="#f0a877" opacity="0.7"/>`,
  ),

  // Energy.
  CL: barrel('#2f3a2a', '#1d2418', '#7ea04d'),
  BZ: barrel('#33302a', '#20201a', '#c9a227'),
  NG: disc(
    '#1f4e6b',
    `<path d="M50 20c10 14 18 20 18 32a18 18 0 1 1-36 0c0-12 8-18 18-32z" fill="#4fc3f7"/>` +
      `<path d="M50 44c5 7 8 10 8 16a8 8 0 1 1-16 0c0-6 3-9 8-16z" fill="#e1f5fe"/>`,
  ),
  RB: disc(
    '#8a2f2f',
    `<path d="M34 30h24a4 4 0 0 1 4 4v42H30V34a4 4 0 0 1 4-4z" fill="#e05252"/>` +
      `<rect x="36" y="38" width="20" height="12" rx="2" fill="#fff" opacity="0.85"/>` +
      `<path d="M62 44h6a4 4 0 0 1 4 4v14a4 4 0 0 1-8 0V50h-2z" fill="#c23b3b"/>`,
  ),

  // Grains.
  ZC: grain('#8a6d1f', '#ffd75e'),
  ZW: grain('#7a6224', '#e3c169'),
  ZS: grain('#4e6b2f', '#a5c96a'),

  // Softs.
  SB: disc(
    '#5c6b7a',
    `<rect x="26" y="34" width="22" height="14" rx="2" fill="#fff"/>` +
      `<rect x="52" y="34" width="22" height="14" rx="2" fill="#eef2f6"/>` +
      `<rect x="39" y="54" width="22" height="14" rx="2" fill="#fff"/>`,
  ),
  KC: disc(
    '#5a3a24',
    `<ellipse cx="50" cy="50" rx="20" ry="27" fill="#c98b5e"/>` +
      `<path d="M50 23c-6 12-6 42 0 54-8-6-13-16-13-27s5-21 13-27z" fill="#8a5a36"/>` +
      `<path d="M50 23c6 12 6 42 0 54" stroke="#5a3a24" stroke-width="3" fill="none"/>`,
  ),
  CT: disc(
    '#4a5a6b',
    `<circle cx="38" cy="44" r="14" fill="#fff"/><circle cx="62" cy="44" r="14" fill="#f4f7fa"/>` +
      `<circle cx="50" cy="58" r="15" fill="#fff"/>` +
      `<path d="M50 73v6M42 70l-3 5M58 70l3 5" stroke="#8b6b4a" stroke-width="3" stroke-linecap="round"/>`,
  ),
  LE: disc(
    '#6b4a3a',
    `<path d="M30 40c0-8 6-12 20-12s20 4 20 12c0 14-9 26-20 26S30 54 30 40z" fill="#c98f6b"/>` +
      `<path d="M30 40c-6-2-10-8-8-14 6-2 12 2 14 8zM70 40c6-2 10-8 8-14-6-2-12 2-14 8z" fill="#8a5f45"/>` +
      `<circle cx="42" cy="44" r="3.5" fill="#3a2a20"/><circle cx="58" cy="44" r="3.5" fill="#3a2a20"/>` +
      `<ellipse cx="50" cy="58" rx="9" ry="6" fill="#8a5f45"/>`,
  ),
};

/** Real artwork for a commodity — never a remote lookup. Null for anything uncataloged. */
export function getCommodityArt(symbol: string): string | null {
  return COMMODITY_ART[symbol] ?? null;
}

/* ── Stock + ETF logo CDNs ─────────────────────────────────────────────────────────────────────── */

const parqet = (symbol: string): string =>
  `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}?format=png`;

const fmp = (symbol: string): string =>
  `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`;

/**
 * Primary: Parqet's logo CDN, keyed by ticker. Covers 476/500 of the Nasdaq screener and 40/40 of
 * the curated ETFs outright. An unknown ticker comes back as a zero-byte body, which fires the
 * <img> onError — so a miss degrades cleanly instead of painting a placeholder.
 */
export const stockLogoUrl = parqet;

/** Secondary, tried when the primary errors. A different corpus, so it catches part of the tail. */
export const stockLogoFallbackUrl = fmp;

/* ── Ticker normalisation, for the tail neither CDN answers on its own ──────────────────────────
 *
 * The last ~3% of the Nasdaq screener isn't random: it's share classes, preferreds, units and
 * when-issued lines. Each is a *derivative* of a listed company that does have a logo, so the fix is
 * to fall back to the underlying base ticker rather than give up and print a letter.
 *
 * This only ever runs AFTER both CDNs have missed on the exact ticker. That ordering matters: a
 * "strip the trailing letter" rule applied eagerly would happily turn a legitimate standalone ticker
 * into a *different* company's logo — the same wrong-but-confident failure the commodities avoid by
 * never touching a stock CDN at all. Missing beats mislabelling.
 */

/**
 * Bases the suffix rule below can't reach: either the ticker doesn't contain its base (STRF→MSTR),
 * or it's too short to strip safely (HONA is 4 chars, and lowering the length guard to catch it
 * would start rewriting ordinary 4-letter tickers like AAPL into AAP — a different company).
 */
const BASE_ALIASES: Record<string, string> = {
  // Strategy Inc's preferred series (STRF/STRD/STRK/STRC) trade off MSTR, not "STR".
  STRF: 'MSTR', STRD: 'MSTR', STRK: 'MSTR', STRC: 'MSTR',
  // Notes / sub-series whose common stock is a shorter ticker.
  SOMN: 'SO', HONA: 'HON', PPLC: 'PPL',
};

/** Class/series suffixes glued onto a base ticker: preferreds (P), notes (Z), units (U), WI lines. */
const CLASS_SUFFIX = /(?:[PZU]|M|N|A|C)$/;

/**
 * The underlying company's ticker for a derivative listing, or null if `symbol` already looks like a
 * plain one. Only the shapes actually seen in the screener are handled.
 */
export function baseTicker(symbol: string): string | null {
  const alias = BASE_ALIASES[symbol];
  if (alias) return alias;

  // Nasdaq writes share classes with a slash ("BRK/B"); the CDNs want a dash ("BRK-B").
  if (symbol.includes('/')) return symbol.replace(/\//g, '-');

  // Otherwise peel one class-marker letter off a long ticker. Guarded to 5+ chars so ordinary
  // 1–4 letter tickers (the overwhelming majority, and the ones at risk of colliding with a real
  // company) are never rewritten.
  if (symbol.length >= 5 && CLASS_SUFFIX.test(symbol)) {
    const base = symbol.slice(0, -1);
    if (base.length >= 2) return base;
  }
  return null;
}

/* ── Letter-chip colour, for the last resort ──────────────────────────────────────────────────── */

const CHIP_COLORS = [
  '#f7931a', '#627eea', '#26a17b', '#f3ba2f', '#2775ca', '#5b6474',
  '#00b98d', '#e84142', '#8247e5', '#0033ad', '#ff007a', '#375bd2',
];

/** Deterministic chip colour, so a given ticker always lands on the same tint. */
export function chipColor(symbol: string): string {
  let h = 0;
  for (const c of symbol) h = c.charCodeAt(0) + ((h << 5) - h);
  return CHIP_COLORS[Math.abs(h) % CHIP_COLORS.length];
}

/**
 * The icon chain for one leaderboard row, in the order the component should try them: the exact
 * ticker on both CDNs first, then — only if both missed — the underlying base ticker for a share
 * class / preferred / unit listing.
 *
 * Commodities yield exactly one entry (their own artwork). By design there is no remote step that
 * could mismatch them onto an equity's logo.
 */
export function iconChain(symbol: string, cls: MarketClass): string[] {
  if (cls === 'commodities') {
    const art = getCommodityArt(symbol);
    return art ? [art] : [];
  }

  const chain = [parqet(symbol), fmp(symbol)];
  const base = baseTicker(symbol);
  if (base) chain.push(parqet(base), fmp(base));
  return chain;
}
