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
  // A missing field sorts as 0 — except rank, where 0 would float unranked rows to the top of an
  // ascending sort, so they sink instead. Compare rather than subtract: Infinity - Infinity is NaN,
  // which would make the comparator inconsistent.
  const missing = sort.key === 'cmcRank' ? Infinity : 0;
  const val = (row) => {
    const v = row[sort.key];
    return typeof v === 'number' && Number.isFinite(v) ? v : missing;
  };
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return [...list].sort((a, b) =>
    sort.dir === 'asc' ? cmp(val(a), val(b)) : cmp(val(b), val(a)),
  );
}

/* ── Leaderboard: rank the board, slice the page, THEN sort within it ── */

const LB_PAGE_SIZE = 100;
const LB_MAX = 500;

/** Crypto ranks by cmcRank (NOT market cap — see below); screener classes arrive pre-ranked. */
function rankBoard(rows, assetClass) {
  if (assetClass === 'crypto') {
    return [...rows]
      .sort((a, b) => (a.cmcRank ?? Infinity) - (b.cmcRank ?? Infinity))
      .slice(0, LB_MAX);
  }
  return rows.slice(0, LB_MAX).map((r, i) => ({ ...r, cmcRank: i + 1 }));
}

/** The page you see: sliced first, sorted second — so a sort can never pull in another page's row. */
function leaderboardPage(rows, assetClass, page, sort = { key: null, dir: 'desc' }) {
  const board = rankBoard(rows, assetClass);
  const start = (page - 1) * LB_PAGE_SIZE;
  return sortList(board.slice(start, start + LB_PAGE_SIZE), sort);
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

console.log('\nLeaderboards — pagination and per-page sorting:');

// 500 coins, ranks 1..500. Two of them (ranks 201/202) are given a top-100-sized market cap: this is
// the real CMC shape — stablecoins / wrapped assets / LP tokens are excluded from CMC's *ranking* but
// still carry a huge cap. Ranking the board by marketCap instead of cmcRank drags them onto page 1.
const BOARD = Array.from({ length: 500 }, (_, i) => {
  const rank = i + 1;
  const inflated = rank === 201 || rank === 202; // e.g. USDY, DEL
  return {
    id: rank,
    symbol: `C${rank}`,
    cmcRank: rank,
    price: 1000 - rank,
    change24h: (rank % 7) - 3,
    // Big enough to outrank a genuine top-50 coin (1e12/50 = 2e10) — that's the whole point.
    marketCap: inflated ? 5e10 : 1e12 / rank,
    volume: 1e9 / rank,
  };
});

check('page 1 is ranks 1–100', () => {
  const p = leaderboardPage(BOARD, 'crypto', 1);
  assert.equal(p.length, 100);
  assert.equal(p[0].cmcRank, 1);
  assert.equal(p[99].cmcRank, 100);
});

check('page 2 is ranks 101–200', () => {
  const p = leaderboardPage(BOARD, 'crypto', 2);
  assert.equal(p[0].cmcRank, 101);
  assert.equal(p[99].cmcRank, 200);
});

check('page 5 is ranks 401–500', () => {
  const p = leaderboardPage(BOARD, 'crypto', 5);
  assert.equal(p[0].cmcRank, 401);
  assert.equal(p[99].cmcRank, 500);
});

// The regression: ordering the board by marketCap put rank-201/202 coins on page 1, while the #
// column still printed their real rank — hence "200-something" numbers on the first page.
check('no rank >100 leaks onto page 1 (the marketCap-ordering bug)', () => {
  const p = leaderboardPage(BOARD, 'crypto', 1);
  assert.ok(p.every((c) => c.cmcRank <= 100), 'a coin ranked >100 appeared on page 1');
  const byCap = [...BOARD].sort((a, b) => b.marketCap - a.marketCap).slice(0, 100);
  assert.ok(byCap.some((c) => c.cmcRank > 100), 'fixture must actually exercise the bug');
});

// The invariant the user asked for: a sort reorders the page, never repopulates it.
check('every sort keeps page membership identical', () => {
  for (const page of [1, 2, 5]) {
    const base = leaderboardPage(BOARD, 'crypto', page)
      .map((c) => c.symbol)
      .sort();
    for (const key of ['cmcRank', 'price', 'change24h', 'marketCap', 'volume']) {
      for (const dir of ['asc', 'desc']) {
        const got = leaderboardPage(BOARD, 'crypto', page, { key, dir })
          .map((c) => c.symbol)
          .sort();
        assert.deepEqual(got, base, `page ${page} membership changed under ${key}/${dir}`);
      }
    }
  }
});

check('sorting reorders the rows it does keep', () => {
  const asc = leaderboardPage(BOARD, 'crypto', 1, { key: 'price', dir: 'asc' });
  const desc = leaderboardPage(BOARD, 'crypto', 1, { key: 'price', dir: 'desc' });
  assert.equal(asc[0].symbol, desc[99].symbol);
  assert.ok(asc[0].price < asc[99].price);
});

check('rank sorts ascending (#1 first), unranked rows sink', () => {
  const rows = [
    { symbol: 'A', cmcRank: 3 },
    { symbol: 'B', cmcRank: null },
    { symbol: 'C', cmcRank: 1 },
  ];
  const asc = sortList(rows, { key: 'cmcRank', dir: 'asc' });
  assert.deepEqual(asc.map((r) => r.symbol), ['C', 'A', 'B']); // null last, not first
});

check('two unranked rows do not produce a NaN comparator', () => {
  const rows = [{ symbol: 'A', cmcRank: null }, { symbol: 'B', cmcRank: null }];
  assert.equal(sortList(rows, { key: 'cmcRank', dir: 'asc' }).length, 2);
});

// Stocks/ETFs/commodities arrive already ranked by the server, so position is just the index.
check('screener classes rank by arrival order', () => {
  const etfs = [
    { symbol: 'IBIT', volume: 10e6 },
    { symbol: 'QQQ', volume: 6e6 },
    { symbol: 'XLE', volume: 4e6 },
  ];
  const p = leaderboardPage(etfs, 'etfs', 1);
  assert.deepEqual(p.map((r) => r.cmcRank), [1, 2, 3]);
  assert.equal(p[0].symbol, 'IBIT');
});

check('a short class (ETFs) fits one page', () => {
  const etfs = Array.from({ length: 40 }, (_, i) => ({ symbol: `E${i}`, volume: 40 - i }));
  assert.equal(leaderboardPage(etfs, 'etfs', 1).length, 40);
  assert.equal(Math.ceil(40 / LB_PAGE_SIZE), 1); // paginator hides itself
});

console.log(failures === 0 ? '\nALL PASS\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
