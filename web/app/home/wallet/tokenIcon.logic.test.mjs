// Pure-logic tests for the token-icon fallback pieces: genericTokenArt (chainIcons.ts) and
// trustWalletLogoUrl (chains.ts).
//
// The behaviour this pins:
//   - A logo-less token no longer shows a bare grey letter. It gets a real-logo attempt (Trust Wallet,
//     by contract) and, failing that, a generic badge tinted with the CHAIN's brand colour + the
//     token's initial — so it reads as "a token on this chain" and is distinct per token.
//   - Trust Wallet's path is case-sensitive, so it's only offered for chains whose balance source
//     returns checksummed addresses (Blockscout chains). Moralis chains (bsc/avalanche) return
//     lowercase and MUST return null here (else every logo would 404), falling to the generic badge.
//
// Run: node app/home/wallet/tokenIcon.logic.test.mjs

import assert from 'node:assert/strict';

const { genericTokenArt } = await import('./chainIcons.ts');
const { trustWalletLogoUrl } = await import('./chains.ts');

/* ── generic badge: chain colour + token initial ── */
const arb = decodeURIComponent(genericTokenArt('arbitrum', 'TRADELAB'));
assert.match(arb, /<circle[^>]*fill="#213147"/, 'arbitrum badge disc must be the Arbitrum brand colour');
assert.match(arb, />T<\/text>/, "badge must show the token's initial");

// Different tokens on the same chain differ (so they are not indistinguishable).
assert.notEqual(genericTokenArt('arbitrum', 'AAA'), genericTokenArt('arbitrum', 'BBB'));

// Same token on different chains differs by colour (tells you the chain).
assert.notEqual(genericTokenArt('arbitrum', 'X'), genericTokenArt('optimism', 'X'));

// BNB's yellow disc uses dark text for legibility; others use white.
assert.match(decodeURIComponent(genericTokenArt('bsc', 'X')), /fill="#1a1a1a"/, 'bsc badge letter must be dark on the yellow disc');
assert.match(decodeURIComponent(genericTokenArt('ethereum', 'X')), /fill="#ffffff"/, 'non-bsc badge letter must be white');

// Empty/exotic symbol degrades to a neutral dot rather than crashing or rendering blank.
assert.match(decodeURIComponent(genericTokenArt('ethereum', '')), /•<\/text>/, 'empty symbol must fall back to a dot');

// Unknown chain still produces a valid badge (neutral grey), never throws.
assert.match(decodeURIComponent(genericTokenArt('nosuchchain', 'Z')), /<circle[^>]*fill="#4b5563"/);

// It's a self-contained data-URI (no network) and valid SVG.
assert.ok(genericTokenArt('base', 'A').startsWith('data:image/svg+xml,'));

/* ── Trust Wallet real-logo URL: only checksummed (Blockscout) chains ── */
const CHECKSUMMED = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
for (const [id, folder] of Object.entries({
  ethereum: 'ethereum',
  arbitrum: 'arbitrum',
  base: 'base',
  polygon: 'polygon',
  optimism: 'optimism',
})) {
  const url = trustWalletLogoUrl(id, CHECKSUMMED);
  assert.equal(
    url,
    `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${CHECKSUMMED}/logo.png`,
    `${id} must build a Trust Wallet URL with the checksummed address verbatim`,
  );
}

// Moralis chains return lowercase addresses → no Trust Wallet (would 404); must be null.
assert.equal(trustWalletLogoUrl('bsc', '0xcd4ccf13f1686df82e9a2b4661cd852b2bc696e3'), null);
assert.equal(trustWalletLogoUrl('avalanche', '0xabc'), null);
// Non-EVM and empty contract → null.
assert.equal(trustWalletLogoUrl('solana', 'MINT'), null);
assert.equal(trustWalletLogoUrl('ethereum', ''), null);

console.log('ok — logo-less tokens get a real-logo attempt then a per-chain tinted badge');
