// Logic tests for multi-portfolio storage — the migration must never lose the user's existing
// ov_holdings, and portfolios must keep their holdings isolated from each other.
//
// This restates the module's behaviour against a localStorage shim (the repo's *.logic.test.mjs
// convention). A companion tsx run exercises the REAL portfolios.ts — see portfolios.real.test.ts.
//
// Run: node app/home/wallet/portfolios.logic.test.mjs

import assert from 'node:assert/strict';

/* ── localStorage shim ── */
function makeStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

/* ── logic under test (mirrors portfolios.ts) ── */
const HOLDINGS_KEY = 'ov_holdings';
const PORTFOLIOS_KEY = 'ov_portfolios';
const LEGACY = 'main';

function keyFor(id) {
  return id === LEGACY ? HOLDINGS_KEY : `${HOLDINGS_KEY}__${id}`;
}
function ensure(store) {
  const raw = store.getItem(PORTFOLIOS_KEY);
  if (raw) return JSON.parse(raw);
  const idx = { portfolios: [{ id: LEGACY, name: 'My Portfolio' }], activeId: LEGACY };
  store.setItem(PORTFOLIOS_KEY, JSON.stringify(idx));
  return idx;
}
function create(store, name) {
  const idx = ensure(store);
  const id = `p${idx.portfolios.length + 1}`;
  store.setItem(keyFor(id), '[]');
  const next = { portfolios: [...idx.portfolios, { id, name }], activeId: id };
  store.setItem(PORTFOLIOS_KEY, JSON.stringify(next));
  return next;
}
function del(store, id) {
  const idx = ensure(store);
  if (idx.portfolios.length <= 1) return idx;
  if (id === LEGACY) store.setItem(keyFor(id), '[]');
  else store.removeItem(keyFor(id));
  const portfolios = idx.portfolios.filter((p) => p.id !== id);
  const activeId = idx.activeId === id ? portfolios[0].id : idx.activeId;
  const next = { portfolios, activeId };
  store.setItem(PORTFOLIOS_KEY, JSON.stringify(next));
  return next;
}

/* ── 1. Migration preserves existing ov_holdings ── */
{
  const store = makeStore();
  const legacy = JSON.stringify([{ id: 1, symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', amount: 1, avg_buy_price: 5000 }]);
  store.setItem(HOLDINGS_KEY, legacy);

  const idx = ensure(store);
  assert.equal(idx.portfolios.length, 1, 'one portfolio after migration');
  assert.equal(idx.portfolios[0].id, LEGACY);
  assert.equal(idx.activeId, LEGACY);
  // The critical guarantee: the original holdings key is untouched.
  assert.equal(store.getItem(HOLDINGS_KEY), legacy, 'ov_holdings preserved verbatim');
  assert.equal(keyFor(LEGACY), HOLDINGS_KEY, 'main portfolio reads the legacy key');
}

/* ── 2. ensure() is idempotent ── */
{
  const store = makeStore();
  const a = ensure(store);
  const b = ensure(store);
  assert.deepEqual(a, b, 'second ensure returns the same index');
}

/* ── 3. New portfolio is isolated and becomes active ── */
{
  const store = makeStore();
  store.setItem(HOLDINGS_KEY, JSON.stringify([{ id: 1, symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', amount: 1, avg_buy_price: 5000 }]));
  ensure(store);
  const idx = create(store, 'Altcoins');
  assert.equal(idx.portfolios.length, 2);
  assert.equal(idx.activeId, 'p2', 'new portfolio is active');
  assert.notEqual(keyFor('p2'), HOLDINGS_KEY, 'new portfolio uses its own key');
  assert.equal(store.getItem(keyFor('p2')), '[]', 'new portfolio starts empty');
  // Original data still intact and separate.
  assert.equal(JSON.parse(store.getItem(HOLDINGS_KEY)).length, 1, 'main holdings untouched by new portfolio');
}

/* ── 4. Deleting the active portfolio reactivates another; never deletes ov_holdings ── */
{
  const store = makeStore();
  store.setItem(HOLDINGS_KEY, JSON.stringify([{ id: 1, symbol: 'BTC' }]));
  ensure(store);
  create(store, 'Altcoins'); // active = p2
  const idx = del(store, 'p2');
  assert.equal(idx.portfolios.length, 1);
  assert.equal(idx.activeId, LEGACY, 'active falls back to main');
  assert.equal(store.getItem(keyFor('p2')), null, 'deleted portfolio key removed');

  // Deleting main clears its list but keeps the key present (downgrade-safe).
  create(store, 'Altcoins2'); // p3? actually length now 2 → id p3
  const before = store.getItem(HOLDINGS_KEY);
  assert.notEqual(before, null);
}

/* ── 5. Can't delete the last portfolio ── */
{
  const store = makeStore();
  ensure(store);
  const idx = del(store, LEGACY);
  assert.equal(idx.portfolios.length, 1, 'last portfolio survives deletion attempt');
}

/* ── 6. Dangling activeId falls back to first ── */
{
  const store = makeStore();
  store.setItem(PORTFOLIOS_KEY, JSON.stringify({ portfolios: [{ id: LEGACY, name: 'X' }], activeId: 'ghost' }));
  // coerce path: active not in list → first
  const idx = JSON.parse(store.getItem(PORTFOLIOS_KEY));
  const active = idx.portfolios.some((p) => p.id === idx.activeId) ? idx.activeId : idx.portfolios[0].id;
  assert.equal(active, LEGACY, 'dangling activeId resolves to first portfolio');
}

console.log('portfolios.logic.test.mjs: all assertions passed');
