// Pure-logic tests for the market page's derivations.
//
// The headline case is Reach's Community Sentiment sort bug: GainersLosers.jsx wires sortable
// column headers on the sentiment table but then renders `list.map(...)` instead of
// `sortList(list).map(...)`, so clicking a header updates sort state and changes nothing on screen.
// `reachRender` below reproduces that; `ourRender` is what MoversView actually does.
//
// Run: node app/home/wallet/movers.logic.test.mjs

import assert from 'node:assert/strict';

/* ── The logic under test (mirrors MoversView.tsx) ── */

const MIN_VOLUME = 50_000;

function sortList(list, sort) {
  if (!sort.key) return list;
  const val = (row) => {
    const v = row[sort.key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  return [...list].sort((a, b) => (sort.dir === 'asc' ? val(a) - val(b) : val(b) - val(a)));
}

// Reach's buggy sentiment render: ignores the sort entirely.
const reachRender = (list, _sort) => list;
// Ours: routes every table through the same sortList.
const ourRender = (list, sort) => sortList(list, sort);

const score = (c) => (c.volume ?? 0) * (c.change24h ?? 0);

function sentiment(coins) {
  const liquid = coins.filter((c) => (c.volume ?? 0) > MIN_VOLUME);
  return {
    bullish: liquid.filter((c) => (c.change24h ?? 0) > 0).sort((a, b) => score(b) - score(a)).slice(0, 15),
    bearish: liquid.filter((c) => (c.change24h ?? 0) < 0).sort((a, b) => score(a) - score(b)).slice(0, 15),
  };
}

function gainersLosers(coins, pool, changeKey) {
  const liquid = coins.filter((c) => (c.volume ?? 0) > MIN_VOLUME);
  const p = pool === 0 ? liquid : liquid.filter((c) => (c.cmcRank ?? Infinity) <= pool);
  const byChange = [...p].sort((a, b) => (b[changeKey] ?? 0) - (a[changeKey] ?? 0));
  return {
    gainers: byChange.filter((c) => (c[changeKey] ?? 0) > 0).slice(0, 30),
    losers: byChange.filter((c) => (c[changeKey] ?? 0) < 0).reverse().slice(0, 30),
  };
}

const fmtPrice = (p) => {
  if (p == null) return '—';
  if (p < 0.001) return `$${p.toFixed(8)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  if (p < 100) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

/* ── Fixtures ── */

const COINS = [
  { id: 1, symbol: 'BTC', cmcRank: 1, price: 62566.41, change1h: 0.1, change24h: -2.17, change7d: -8, change30d: 5, volume: 21_430_000_000, marketCap: 1.25e12 },
  { id: 2, symbol: 'ETH', cmcRank: 2, price: 1770.2, change1h: -0.2, change24h: -1.93, change7d: -6, change30d: 3, volume: 9_480_000_000, marketCap: 2.13e11 },
  { id: 3, symbol: 'XEC', cmcRank: 153, price: 0.00000666, change1h: 1, change24h: 29.14, change7d: 40, change30d: 60, volume: 82_740_000, marketCap: 1.33e8 },
  { id: 4, symbol: 'KITE', cmcRank: 115, price: 0.137836, change1h: 2, change24h: 21.18, change7d: 30, change30d: 55, volume: 121_020_000, marketCap: 2.48e8 },
  { id: 5, symbol: 'DUST', cmcRank: 900, price: 0.01, change1h: 0, change24h: 99.0, change7d: 0, change30d: 0, volume: 1_000, marketCap: 5_000 }, // illiquid
  { id: 6, symbol: 'LAB', cmcRank: 253, price: 0.32504, change1h: -3, change24h: -32.12, change7d: -50, change30d: -60, volume: 80_950_000, marketCap: 8e7 },
];

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
};

console.log('\nCommunity Sentiment sort (the Reach bug):');

const { bullish } = sentiment(COINS);
const byPriceDesc = { key: 'price', dir: 'desc' };

// The default (momentum) order must differ from price order, or the two renderers would agree by
// coincidence and the test couldn't tell the bug from the fix.
const SENTIMENT_FIXTURE = [
  // Huge momentum, tiny price — momentum ranks it #1, price ranks it last.
  { id: 10, symbol: 'XEC', cmcRank: 153, price: 0.00000666, change24h: 29.14, volume: 900_000_000 },
  // Modest momentum, huge price — momentum ranks it last, price ranks it #1.
  { id: 11, symbol: 'WBTC', cmcRank: 20, price: 62_000, change24h: 1.2, volume: 60_000_000 },
];

check('REPRO: Reach ignores the sort — clicking "Price" changes nothing', () => {
  const list = sentiment(SENTIMENT_FIXTURE).bullish;
  assert.deepEqual(list.map((c) => c.symbol), ['XEC', 'WBTC'], 'default order is by momentum');

  const out = reachRender(list, byPriceDesc);
  // The bug: output is byte-for-byte the momentum order, NOT price-sorted.
  assert.deepEqual(out.map((c) => c.symbol), ['XEC', 'WBTC']);
  const prices = out.map((c) => c.price);
  const isSorted = prices.every((p, i) => i === 0 || prices[i - 1] >= p);
  assert.equal(isSorted, false, 'expected Reach output NOT to be price-sorted (that IS the bug)');
});

check('FIX: ours reorders the same list by price', () => {
  const list = sentiment(SENTIMENT_FIXTURE).bullish;
  const out = ourRender(list, byPriceDesc);
  assert.deepEqual(out.map((c) => c.symbol), ['WBTC', 'XEC'], 'price desc must hoist WBTC');
});

check('FIX: ours actually sorts by price descending', () => {
  const out = ourRender(bullish, byPriceDesc);
  const prices = out.map((c) => c.price);
  const isSorted = prices.every((p, i) => i === 0 || prices[i - 1] >= p);
  assert.equal(isSorted, true, `not sorted: ${prices.join(', ')}`);
});

check('FIX: ascending toggle works too', () => {
  const out = ourRender(bullish, { key: 'price', dir: 'asc' });
  const prices = out.map((c) => c.price);
  assert.ok(prices.every((p, i) => i === 0 || prices[i - 1] <= p), `not asc: ${prices.join(', ')}`);
});

console.log('\nSentiment derivation:');

check('bullish = positive 24h only, ranked by volume x change', () => {
  const { bullish: b } = sentiment(COINS);
  assert.ok(b.every((c) => c.change24h > 0));
  // KITE: 121.02M * 21.18 = 2.56e9 beats XEC: 82.74M * 29.14 = 2.41e9 — momentum, not raw %.
  assert.equal(b[0].symbol, 'KITE');
});

check('bearish = negative 24h only, most-negative momentum first', () => {
  const { bearish } = sentiment(COINS);
  assert.ok(bearish.every((c) => c.change24h < 0));
  assert.equal(bearish[0].symbol, 'BTC'); // 21.43B * -2.17 dwarfs the rest
});

check('illiquid coins are excluded despite a huge % move', () => {
  const { bullish: b } = sentiment(COINS);
  assert.equal(b.find((c) => c.symbol === 'DUST'), undefined, 'DUST (+99%, $1k vol) must be filtered');
});

console.log('\nGainers & Losers:');

check('pool cap respects cmcRank', () => {
  const { gainers } = gainersLosers(COINS, 100, 'change24h');
  assert.deepEqual(gainers.map((c) => c.symbol), []); // XEC(153)/KITE(115) are outside the top 100
});

check('pool = All includes them', () => {
  const { gainers } = gainersLosers(COINS, 0, 'change24h');
  assert.deepEqual(gainers.map((c) => c.symbol), ['XEC', 'KITE']);
});

check('losers ascend (worst first)', () => {
  const { losers } = gainersLosers(COINS, 0, 'change24h');
  assert.equal(losers[0].symbol, 'LAB'); // -32.12 is the worst
});

check('timeframe switches the ranked field', () => {
  const { gainers } = gainersLosers(COINS, 0, 'change30d');
  assert.equal(gainers[0].symbol, 'XEC'); // +60% over 30d
  assert.ok(gainers.some((c) => c.symbol === 'BTC')); // +5% on 30d, though negative on 24h
});

console.log('\nPrice formatting (decimal tiers):');

check('sub-cent coins keep 8 decimals', () => assert.equal(fmtPrice(0.00000666), '$0.00000666'));
check('sub-dollar keeps 6', () => assert.equal(fmtPrice(0.137836), '$0.137836'));
check('sub-$100 keeps 2', () => assert.equal(fmtPrice(6.58), '$6.58'));
check('large prices get separators', () => assert.equal(fmtPrice(62566.41), '$62,566.41'));
check('null price renders a dash', () => assert.equal(fmtPrice(null), '—'));

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
