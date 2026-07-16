// Pure-logic tests for the Explorer's client-side detection (explorerDetect.ts): resolving the
// pasted query + active family pill to a chain, classifying hash-vs-address, and building the
// tx-detail explorer URL. Style mirrors tokenExplorer.logic.test.mjs.
//
// Run: node app/home/wallet/explorerDetect.logic.test.mjs

import assert from 'node:assert/strict';

const { resolveChain, classify, txUrlClient } = await import('./explorerDetect.ts');
const { getChain } = await import('./chains.ts');

const EVM_ADDR = '0x00000000219ab540356cBB839Cbe05303d7705Fa';
const EVM_TX = '0x' + 'a'.repeat(64);
const SUI_ADDR = '0x' + 'b'.repeat(64);
const SOL_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const SOL_SIG = '5'.repeat(88);
const CARDANO_ADDR = 'addr1qxwn5rd6ad92md23vpazl73mq92gyww756cjwyptcv77ljya8gxm46624k64zcr69larkq25sguaaf43yugzhseaalyqad8n24';

/* ── resolveChain: family pill overrides auto-detect ── */
// `all` → auto-detect via detectChain
assert.equal(resolveChain(EVM_ADDR, 'all', 'ethereum'), 'ethereum', 'all + EVM addr → ethereum');
assert.equal(resolveChain(SOL_ADDR, 'all', 'ethereum'), 'solana', 'all + solana addr → solana');
assert.equal(resolveChain(CARDANO_ADDR, 'all', 'ethereum'), 'cardano', 'all + cardano addr → cardano');
assert.equal(resolveChain(SUI_ADDR, 'all', 'ethereum'), 'sui', 'all + 0x+64 → sui (shape)');
// single-chain family forces its chain regardless of shape
assert.equal(resolveChain(EVM_ADDR, 'Solana', 'ethereum'), 'solana', 'Solana pill forces solana');
assert.equal(resolveChain(EVM_ADDR, 'NEAR', 'ethereum'), 'near', 'NEAR pill forces near');
// EVM family forces the selected EVM sub-chain
assert.equal(resolveChain(EVM_ADDR, 'EVM', 'base'), 'base', 'EVM pill + base sub-chain → base');
assert.equal(resolveChain(EVM_ADDR, 'EVM', 'arbitrum'), 'arbitrum', 'EVM pill + arbitrum → arbitrum');
// empty query
assert.equal(resolveChain('   ', 'all', 'ethereum'), null, 'blank query → null');

/* ── classify: hash vs address ── */
assert.equal(classify(EVM_ADDR, 'ethereum'), 'address', 'evm 0x+40 → address');
assert.equal(classify(EVM_TX, 'ethereum'), 'tx', 'evm 0x+64 → tx');
assert.equal(classify(SUI_ADDR, 'sui'), 'address', 'sui 0x+64 → address (ambiguous, defaults address)');
assert.equal(classify(SOL_ADDR, 'solana'), 'address', 'solana 44-char → address');
assert.equal(classify(SOL_SIG, 'solana'), 'tx', 'solana 88-char → tx');

/* ── txUrlClient: address path → tx path per family ── */
const eth = getChain('ethereum');
const sol = getChain('solana');
const sui = getChain('sui');
const near = getChain('near');
const cardano = getChain('cardano');
const tron = getChain('tron');
assert.equal(txUrlClient(eth, EVM_TX), `https://etherscan.io/tx/${EVM_TX}`, 'eth → /tx/');
assert.equal(txUrlClient(sol, 'SIG'), 'https://solscan.io/tx/SIG', 'solana /account/ → /tx/');
assert.equal(txUrlClient(sui, 'DIG'), 'https://suiscan.xyz/mainnet/tx/DIG', 'sui /mainnet/account/ → /mainnet/tx/');
assert.equal(txUrlClient(near, 'H'), 'https://nearblocks.io/txns/H', 'near → /txns/');
assert.equal(txUrlClient(cardano, 'H'), 'https://cardanoscan.io/transaction/H', 'cardano → /transaction/');
assert.equal(txUrlClient(tron, 'H'), 'https://tronscan.org/#/transaction/H', 'tron → /#/transaction/');
for (const c of [eth, sol, sui, near, cardano, tron]) {
  const u = txUrlClient(c, 'H');
  assert.ok(!/\/address\//.test(u) && !/\/account\//.test(u), `${c.id} tx URL must not point at the address page: ${u}`);
}

console.log('ok — Explorer detection resolves family/chain, classifies hash-vs-address, and builds correct tx URLs');
