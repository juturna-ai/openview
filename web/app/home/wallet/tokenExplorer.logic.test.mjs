// Pure-logic tests for tokenExplorerUrl (chains.ts) — the link a token row opens in the wallet detail.
//
// The behaviour this pins:
//   - An ERC-20 row links to that token's per-contract page on the chain's explorer, NOT the wallet
//     address page. Before this feature every row (if it linked at all) went to /address/, so you
//     couldn't jump to a specific token.
//   - The native coin (ETH/BNB/…) has no contract, so it links to the wallet's address page instead.
//   - The token path differs per explorer family and is derived from chain.explorer, so a wrong
//     family (Tron's /#/token20/, Solana's /token/) would produce a 404 link — asserted per chain.
//
// Run: node app/home/wallet/tokenExplorer.logic.test.mjs

import assert from 'node:assert/strict';

const { getChain, tokenExplorerUrl } = await import('./chains.ts');

const WALLET = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const ERC20 = '0xdAC17F958D2ee523a2206206994597C13D831ec7'; // USDT on Ethereum

/* ── native coin → wallet address page (no contract) ── */
assert.equal(
  tokenExplorerUrl(getChain('ethereum'), { native: true, contractAddress: '', walletAddress: WALLET }),
  `https://etherscan.io/address/${WALLET}`,
  'native ETH row must link to the wallet address page',
);

/* ── a token with an empty contract also falls back to the address page (no /token/ with no id) ── */
assert.equal(
  tokenExplorerUrl(getChain('ethereum'), { native: false, contractAddress: '', walletAddress: WALLET }),
  `https://etherscan.io/address/${WALLET}`,
  'a token row with no contract must not build a dangling /token/ URL',
);

/* ── EVM etherscan-family: /address/ → /token/{contract} ── */
const EVM_EXPECT = {
  ethereum: `https://etherscan.io/token/${ERC20}`,
  bsc: `https://bscscan.com/token/${ERC20}`,
  polygon: `https://polygonscan.com/token/${ERC20}`,
  arbitrum: `https://arbiscan.io/token/${ERC20}`,
  optimism: `https://optimistic.etherscan.io/token/${ERC20}`,
  base: `https://basescan.org/token/${ERC20}`,
  avalanche: `https://snowtrace.io/token/${ERC20}`,
};
for (const [id, url] of Object.entries(EVM_EXPECT)) {
  assert.equal(
    tokenExplorerUrl(getChain(id), { native: false, contractAddress: ERC20, walletAddress: WALLET }),
    url,
    `${id} token link must point at the /token/ page`,
  );
}

/* ── non-EVM families use their own token path, not /address/ or a bare /token/ ── */
assert.equal(
  tokenExplorerUrl(getChain('solana'), { native: false, contractAddress: 'MINT123', walletAddress: WALLET }),
  'https://solscan.io/token/MINT123',
  'solana token link must use /token/ (from /account/)',
);
assert.equal(
  tokenExplorerUrl(getChain('tron'), { native: false, contractAddress: 'TTOKEN123', walletAddress: WALLET }),
  'https://tronscan.org/#/token20/TTOKEN123',
  'tron token link must use /#/token20/',
);

// No family's token URL may still contain the /address/ segment — that would be the wrong page.
for (const id of ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche', 'solana', 'tron']) {
  const url = tokenExplorerUrl(getChain(id), { native: false, contractAddress: ERC20, walletAddress: WALLET });
  assert.ok(!/\/address\//.test(url) && !/\/account\//.test(url), `${id} token URL must not point at the address page: ${url}`);
}

console.log('ok — token rows link to the right per-explorer token page; native links to the address page');
