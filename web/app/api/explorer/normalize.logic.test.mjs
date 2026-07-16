// Pure-logic tests for the Explorer normalizers (normalize.ts) — the functions that turn each
// upstream's tx payload into one chain-agnostic ExplorerTx. These run under plain `node` because
// normalize.ts imports only chains.server.ts (no next/server), same split as ../wallet-tracker/hosts.ts.
//
// What's pinned here:
//   - fromUnits divides by the right decimals without a lossy cast.
//   - direction (in/out/self) is computed relative to the queried address, case-insensitively.
//   - each source maps to the ExplorerTx shape with the right native symbol, timestamp unit, status.
//
// Run: node app/api/explorer/normalize.logic.test.mjs

import assert from 'node:assert/strict';

const {
  fromUnits,
  directionFor,
  isTxHash,
  validHash,
  txUrl,
  normalizeBlockscout,
  normalizeSui,
  normalizeCardano,
  normalizeNear,
  normalizeSolanaSig,
} = await import('./normalize.ts');

/* ── fromUnits ── */
assert.equal(fromUnits(1000000000000000000n, 18), 1, '1e18 wei = 1 ETH');
assert.equal(fromUnits(1500000n, 6), 1.5, '1.5e6 lovelace-scale = 1.5');
assert.equal(fromUnits(0n, 18), 0, 'zero stays zero');

/* ── direction relative to the queried address (case-insensitive) ── */
const A = '0xAbC0000000000000000000000000000000000001';
const B = '0xDeF0000000000000000000000000000000000002';
assert.equal(directionFor(A, A, B), 'out', 'from == queried → out');
assert.equal(directionFor(A, B, A), 'in', 'to == queried → in');
assert.equal(directionFor(A, A, A), 'self', 'both == queried → self');
assert.equal(directionFor(A.toLowerCase(), A.toUpperCase(), B), 'out', 'case-insensitive match');
assert.equal(directionFor(A, B, B), null, 'neither side → null');
assert.equal(directionFor('', A, B), null, 'no queried address → null');

/* ── hash vs address classification ── */
const EVM_TX = '0x' + 'a'.repeat(64);
const EVM_ADDR = '0x' + 'b'.repeat(40);
assert.equal(isTxHash(EVM_TX, 'evm'), true, 'evm 0x+64 is a tx hash');
assert.equal(isTxHash(EVM_ADDR, 'evm'), false, 'evm 0x+40 is an address');
assert.equal(isTxHash('9'.repeat(88), 'solana'), true, 'solana 88-char base58 is a signature');
assert.equal(isTxHash('9'.repeat(44), 'solana'), false, 'solana 44-char is an address');
assert.equal(validHash(EVM_TX, 'evm'), true, 'evm tx hash validates');
assert.equal(validHash('0xzz', 'evm'), false, 'malformed evm hash rejected');

/* ── tx-detail URL builder (address path → tx path per family) ── */
assert.equal(txUrl('ethereum', EVM_TX), `https://etherscan.io/tx/${EVM_TX}`, 'eth → /tx/');
assert.equal(txUrl('base', EVM_TX), `https://basescan.org/tx/${EVM_TX}`, 'base → /tx/');
assert.equal(txUrl('solana', 'SIG'), 'https://solscan.io/tx/SIG', 'solana /account/ → /tx/');
assert.equal(txUrl('sui', 'DIG'), 'https://suiscan.xyz/mainnet/tx/DIG', 'sui → /tx/');
assert.equal(txUrl('cardano', 'H'), 'https://cardanoscan.io/transaction/H', 'cardano → /transaction/');
assert.equal(txUrl('near', 'H'), 'https://nearblocks.io/txns/H', 'near → /txns/');
assert.equal(txUrl('tron', 'H'), 'https://tronscan.org/#/transaction/H', 'tron → /#/transaction/');
for (const id of ['ethereum', 'base', 'solana', 'sui', 'cardano', 'near', 'tron']) {
  const u = txUrl(id, 'H');
  assert.ok(!/\/address\//.test(u) && !/\/account\//.test(u), `${id} tx URL must not point at the address page: ${u}`);
}

/* ── Blockscout EVM tx ── */
const bs = normalizeBlockscout(
  {
    hash: EVM_TX,
    timestamp: '2023-01-01T00:00:00.000000Z',
    from: { hash: A },
    to: { hash: B },
    value: '1000000000000000000', // 1 ETH
    fee: { value: '21000000000000' }, // 0.000021 ETH
    status: 'ok',
    method: 'transfer',
  },
  'ethereum',
  A,
);
assert.equal(bs.value, 1, 'blockscout value → 1 ETH');
assert.equal(bs.symbol, 'ETH', 'blockscout native symbol');
assert.equal(bs.direction, 'out', 'blockscout direction from queried A');
assert.equal(bs.status, 'success', 'status ok → success');
assert.equal(bs.method, 'transfer', 'method carried through');
assert.equal(bs.timestamp, Math.floor(Date.parse('2023-01-01T00:00:00Z') / 1000), 'ISO → unix seconds');

/* ── Sui tx block ── */
const sui = normalizeSui(
  {
    digest: 'DIGEST123',
    timestampMs: '1700000000000',
    transaction: { data: { sender: A } },
    effects: { status: { status: 'success' }, gasUsed: { computationCost: '1000000', storageCost: '2000000', storageRebate: '500000' } },
  },
  A,
);
assert.equal(sui.hash, 'DIGEST123', 'sui digest');
assert.equal(sui.symbol, 'SUI', 'sui native symbol');
assert.equal(sui.timestamp, 1700000000, 'sui ms → seconds');
assert.equal(sui.direction, 'out', 'sui sender == queried → out');
assert.equal(sui.status, 'success', 'sui status');
assert.ok(sui.fee > 0, 'sui fee computed from gasUsed');

/* ── Cardano address_txs row ── */
const ada = normalizeCardano({ tx_hash: 'CARDANOTX', block_time: 1699999999 });
assert.equal(ada.hash, 'CARDANOTX', 'cardano hash');
assert.equal(ada.symbol, 'ADA', 'cardano native symbol');
assert.equal(ada.timestamp, 1699999999, 'cardano block_time seconds');

/* ── NEAR txns row (ns timestamp, yocto deposit) ── */
const near = normalizeNear(
  {
    transaction_hash: 'NEARTX',
    block_timestamp: '1700000000000000000', // ns
    signer_account_id: 'alice.near',
    receiver_account_id: 'bob.near',
    actions: [{ action: 'FunctionCall' }],
    actions_agg: { deposit: 2e24 }, // 2 NEAR
    outcomes: { status: true },
  },
  'alice.near',
);
assert.equal(near.hash, 'NEARTX', 'near hash');
assert.equal(near.symbol, 'NEAR', 'near native symbol');
assert.equal(near.timestamp, 1700000000, 'near ns → seconds');
assert.equal(near.value, 2, 'near yocto deposit → 2 NEAR');
assert.equal(near.direction, 'out', 'near signer == queried → out');
assert.equal(near.method, 'FunctionCall', 'near first action label');
assert.equal(near.status, 'success', 'near status true → success');

/* ── Solana signature row (no from/to without a full fetch; status from err) ── */
const solOk = normalizeSolanaSig({ signature: 'SIG', blockTime: 1700000000, err: null }, A);
assert.equal(solOk.hash, 'SIG', 'solana signature');
assert.equal(solOk.symbol, 'SOL', 'solana native symbol');
assert.equal(solOk.status, 'success', 'no err → success');
const solErr = normalizeSolanaSig({ signature: 'SIG2', blockTime: 1, err: { InstructionError: [] } }, A);
assert.equal(solErr.status, 'failed', 'err present → failed');

console.log('ok — Explorer normalizers map every source to the ExplorerTx shape with correct units, direction and status');
