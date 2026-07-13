// Tests for the seed migration in loadTracked (chains.ts).
//
// The situation: DEFAULT_WALLETS went from Reach's 20 Ethereum-heavy addresses to 173 (~20 per chain
// across all 10). Anyone who had already used the tracker has the OLD 20 sitting in localStorage, and
// loadTracked only ever seeded when the key had never been written — so they'd never see the new set.
//
// The migration swaps stale seeds for current ones. The thing it must never do is touch a wallet the
// user added themselves, or resurrect wallets under someone who deliberately cleared the list. Those
// are the cases pinned below — this is user data, and a wrong migration silently destroys it.
//
// Run: node app/home/wallet/seedMigration.logic.test.mjs

import assert from 'node:assert/strict';

/* ── Mirrors chains.ts ── */

const SEED_ID_PREFIX = 'default-';
const SEED_VERSION = 2;
const TRACKED_KEY = 'ov_tracked_wallets';
const SEED_VERSION_KEY = 'ov_tracked_seed_version';

// Stand-ins for the real seed sets.
const OLD_SEEDS = [
  { id: 'default-0', address: '0xvitalik', chain: 'ethereum', label: 'Vitalik' },
  { id: 'default-1', address: '0xbinance', chain: 'ethereum', label: 'Binance Cold' },
];
const NEW_SEEDS = [
  { id: 'default-0', address: '0xbeacon', chain: 'ethereum', label: 'Beacon Deposit' },
  { id: 'default-1', address: '0xweth', chain: 'ethereum', label: 'WETH' },
  { id: 'default-2', address: 'SoL111', chain: 'solana', label: 'Alameda' },
];
const defaultWallets = () => NEW_SEEDS.map((w) => ({ ...w }));

const KNOWN_CHAINS = new Set(['ethereum', 'solana', 'tron', 'polygon']);
const getChain = (id) => (KNOWN_CHAINS.has(id) ? { id } : undefined);

/** A minimal localStorage. */
function makeStore(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    dump: () => Object.fromEntries(m),
  };
}

/** loadTracked, verbatim in logic from chains.ts, with storage injected. */
function loadTracked(store) {
  try {
    const raw = store.getItem(TRACKED_KEY);
    if (raw === null) return defaultWallets();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultWallets();

    const stored = parsed.filter(
      (w) =>
        !!w &&
        typeof w === 'object' &&
        typeof w.address === 'string' &&
        typeof w.id === 'string' &&
        !!getChain(w.chain),
    );

    const seenVersion = Number(store.getItem(SEED_VERSION_KEY) ?? '1');
    if (seenVersion >= SEED_VERSION) return stored;

    // NOTE: no store.setItem here — see the StrictMode test below.
    const userAdded = stored.filter((w) => !w.id.startsWith(SEED_ID_PREFIX));
    if (stored.length === 0) return [];
    return [...defaultWallets(), ...userAdded];
  } catch {
    return defaultWallets();
  }
}

const USER_WALLET = { id: '1720000000-ab12cd', address: '0xmine', chain: 'ethereum' };
const USER_WALLET_2 = { id: '1720000001-ef34gh', address: 'SoLmine', chain: 'solana', label: 'My SOL' };

let passed = 0;
const t = (name, fn) => {
  fn();
  console.log(`  ok  ${name}`);
  passed++;
};

/* ── The reported problem ── */

t('REGRESSION: an existing user holding the OLD seeds gets the NEW ones', () => {
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify(OLD_SEEDS) });
  const out = loadTracked(store);
  assert.deepEqual(out, NEW_SEEDS, 'stale seeds must be replaced by the current set');
  assert.ok(
    !out.some((w) => w.address === '0xvitalik'),
    'the superseded seed should be gone, not duplicated alongside the new set',
  );
});

t('without the migration they would have been stuck on the old 20 (proves the test bites)', () => {
  // seenVersion already current => no migration => stale list returned as-is.
  const store = makeStore({
    [TRACKED_KEY]: JSON.stringify(OLD_SEEDS),
    [SEED_VERSION_KEY]: String(SEED_VERSION),
  });
  assert.deepEqual(loadTracked(store), OLD_SEEDS);
});

/* ── User data must survive. These are the ones that matter. ── */

t("a user's own wallets are preserved through the migration", () => {
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify([...OLD_SEEDS, USER_WALLET, USER_WALLET_2]) });
  const out = loadTracked(store);
  assert.ok(out.some((w) => w.address === '0xmine'), 'user wallet was destroyed by the migration');
  assert.ok(out.some((w) => w.address === 'SoLmine'), 'user wallet was destroyed by the migration');
  assert.equal(out.length, NEW_SEEDS.length + 2, 'expected new seeds + both user wallets');
});

t("a user's wallet keeps its id and label verbatim", () => {
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify([...OLD_SEEDS, USER_WALLET_2]) });
  const kept = loadTracked(store).find((w) => w.address === 'SoLmine');
  assert.deepEqual(kept, USER_WALLET_2, 'user wallet must round-trip unchanged');
});

t('a deliberately-emptied tracker STAYS empty — 173 wallets do not reappear', () => {
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify([]) });
  assert.deepEqual(loadTracked(store), [], 'clearing the list must be respected');
});

t('a user with ONLY their own wallets (no seeds) keeps them, and gains the new seeds', () => {
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify([USER_WALLET]) });
  const out = loadTracked(store);
  assert.ok(out.some((w) => w.address === '0xmine'));
  assert.equal(out.length, NEW_SEEDS.length + 1);
});

/* ── Version bookkeeping ── */

t('REGRESSION (StrictMode): loadTracked is a pure read — calling it twice yields the same list', () => {
  // React 18 StrictMode double-invokes the mount effect, so loadTracked runs twice against the SAME
  // storage. An earlier version stamped SEED_VERSION during the read: the second call then saw the
  // new version, skipped the migration, and returned the *stale* 3-wallet list it had just replaced
  // — the migration silently undid itself. Caught in the browser, pinned here.
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify([...OLD_SEEDS, USER_WALLET]) });
  const first = loadTracked(store);
  const second = loadTracked(store);
  assert.deepEqual(second, first, 'a second read must not lose the migration');
  assert.equal(first.length, NEW_SEEDS.length + 1);
  assert.equal(store.getItem(SEED_VERSION_KEY), null, 'reading must not write the version');
});

t('saveTracked owns the version stamp, so the migration settles after the first persist', () => {
  const store = makeStore({ [TRACKED_KEY]: JSON.stringify(OLD_SEEDS) });
  const migrated = loadTracked(store);
  // The view persists whatever loadTracked returned.
  store.setItem(TRACKED_KEY, JSON.stringify(migrated));
  store.setItem(SEED_VERSION_KEY, String(SEED_VERSION)); // what saveTracked does
  // Next visit: version is current, list passes straight through — no re-migration.
  assert.deepEqual(loadTracked(store), NEW_SEEDS, 'no re-migration on later loads');
});

t('a brand-new user (nothing stored) gets the current seeds', () => {
  assert.deepEqual(loadTracked(makeStore()), NEW_SEEDS);
});

/* ── Corruption guards ── */

t('corrupt JSON falls back to the defaults rather than throwing', () => {
  assert.deepEqual(loadTracked(makeStore({ [TRACKED_KEY]: '{not json' })), NEW_SEEDS);
});

t('a non-array payload falls back to the defaults', () => {
  assert.deepEqual(loadTracked(makeStore({ [TRACKED_KEY]: '{"a":1}' })), NEW_SEEDS);
});

t('rows with an unknown chain or missing fields are dropped, not rendered as broken cards', () => {
  const store = makeStore({
    [TRACKED_KEY]: JSON.stringify([USER_WALLET, { id: 'x', address: '0xz', chain: 'dogecoin' }, null, { id: 'y' }]),
    [SEED_VERSION_KEY]: String(SEED_VERSION),
  });
  assert.deepEqual(loadTracked(store), [USER_WALLET]);
});

console.log(`\n${passed} passed`);
console.log('ALL PASS');
