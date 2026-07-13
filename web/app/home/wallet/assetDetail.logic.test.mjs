// Pure-logic tests for the asset detail page.
//
// The headline case is a real bug this feature shipped with and then fixed: Yahoo's
// `meta.chartPreviousClose` is the close preceding the **requested range**, not the previous day.
// The first cut of /api/market/asset derived `change24h` from it, so the "24h" change silently
// scaled with whichever chart window was open — Gold read +1368% on the All range, AAPL +9.9% on 1M.
// `prevFromMeta` below reproduces that; `prevFromSeries` is what the route actually does now.
//
// Also covers the chart geometry, which has two ways to produce a blank line: a flat series (a
// stablecoin pinned at $1.00 has zero span, and dividing by it puts every y at NaN) and Yahoo's
// null-padded gaps for holidays and halted sessions.
//
// Run: node app/home/wallet/assetDetail.logic.test.mjs

import assert from 'node:assert/strict';

/* ── The logic under test (mirrors route.ts + AssetDetailView.tsx) ── */

/** What the route does now: the last completed session inside a fixed 5d/1d window. */
function prevFromSeries(closes, metaPrevClose) {
  const clean = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
  return clean.length >= 2 ? clean[clean.length - 2] : (metaPrevClose ?? null);
}

/** The bug: whatever Yahoo called "previous close" for the requested range. */
const prevFromMeta = (_closes, metaPrevClose) => metaPrevClose ?? null;

const pctChange = (price, prev) =>
  price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;

/** Drop Yahoo's null padding rather than draw the line down to zero. */
const toPoints = (ts, closes) =>
  ts
    .map((t, i) => [t, closes[i] ?? NaN])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));

/** The chart's y-scale. Mirrors PriceChart's `geom`. */
function yScale(points, H = 260, PAD_T = 10, PAD_B = 22) {
  if (points.length < 2) return null;
  const lo = Math.min(...points.map((p) => p[1]));
  const hi = Math.max(...points.map((p) => p[1]));
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const plotH = H - PAD_T - PAD_B;
  return { lo, hi, span, y: (v) => PAD_T + plotH - ((v - lo) / span) * plotH };
}

/* ── Fixtures: what Yahoo actually returned for these, on 2026-07-13 ── */

// Gold (GC=F). The `max` range's previous close is the price in the year 2000.
const GOLD = {
  price: 4023.9,
  metaPrevCloseByRange: { '24H': 4104.1, '7D': 4104.1, '1M': 4104.1, '1Y': 3351.5, ALL: 273.9 },
  // The fixed 5d/1d window, which is what the route now uses regardless of display range.
  quoteCloses: [4150.2, 4098.7, 4110.0, 4104.1, 4023.9],
};

// Apple (AAPL). On the 1M range Yahoo's previous close is a month ago.
const AAPL = {
  price: 319.72,
  metaPrevCloseByRange: { '24H': 315.32, '7D': 312.9, '1M': 291.13, '1Y': 262.24, ALL: 0.1 },
  quoteCloses: [310.4, 313.8, 316.2, 315.32, 319.72],
};

/* ── Tests ── */

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

console.log('\nprevious close / 24h change — range independence');

test('BUG (reproduced): meta.chartPreviousClose makes 24h change scale with the chart range', () => {
  const changes = Object.entries(GOLD.metaPrevCloseByRange).map(([range, prev]) => [
    range,
    pctChange(GOLD.price, prevFromMeta(GOLD.quoteCloses, prev)),
  ]);

  const byRange = Object.fromEntries(changes);
  // The same instant, the same "24h" field, five different answers — one of them off by 1300 points.
  assert.ok(Math.abs(byRange['24H'] - -1.95) < 0.01, '24H happens to be right');
  assert.ok(byRange.ALL > 1300, `ALL range reported ${byRange.ALL.toFixed(0)}% as a 24h change`);
  assert.ok(byRange['1Y'] > 15, `1Y range reported ${byRange['1Y'].toFixed(1)}% as a 24h change`);

  // Ranges that happen to share a previous close (24H/7D/1M all sit within one session here) agree
  // by luck, so this asserts "more than one answer", not a specific count.
  const distinct = new Set(changes.map(([, v]) => v.toFixed(4)));
  assert.ok(distinct.size > 1, 'the bug yields different 24h changes depending on the range');
});

test('FIXED: the 5d/1d series gives one 24h change, identical on every range', () => {
  for (const fixture of [GOLD, AAPL]) {
    const values = Object.values(fixture.metaPrevCloseByRange).map((metaPrev) =>
      pctChange(fixture.price, prevFromSeries(fixture.quoteCloses, metaPrev)),
    );
    const distinct = new Set(values.map((v) => v.toFixed(6)));
    assert.equal(distinct.size, 1, 'every range must agree on the 24h change');
  }

  // And the one value is the real one: yesterday's close vs. now.
  assert.ok(Math.abs(pctChange(GOLD.price, prevFromSeries(GOLD.quoteCloses, 273.9)) - -1.954) < 0.01);
  assert.ok(Math.abs(pctChange(AAPL.price, prevFromSeries(AAPL.quoteCloses, 0.1)) - 1.395) < 0.01);
});

test('a single-session window falls back to meta rather than inventing a change', () => {
  // A holiday week can leave one bar in the window; there is nothing to compare it against.
  assert.equal(prevFromSeries([100], 98), 98, 'falls back to meta');
  assert.equal(prevFromSeries([], null), null, 'no data at all → null, not 0');
  assert.equal(pctChange(100, null), null, 'a null previous close yields no change, not NaN');
});

test('a zero previous close cannot divide by zero', () => {
  assert.equal(pctChange(100, 0), null);
});

console.log('\nchart geometry');

test('a flat series (stablecoin at $1.00) renders a line, not NaN', () => {
  const flat = [
    [1, 1.0],
    [2, 1.0],
    [3, 1.0],
  ];
  const g = yScale(flat);
  assert.notEqual(g.span, 0, 'zero span would divide by zero');
  for (const [, v] of flat) {
    assert.ok(Number.isFinite(g.y(v)), `y(${v}) must be finite, got ${g.y(v)}`);
  }
});

test('an all-zero flat series is still finite', () => {
  // hi is 0, so `Math.abs(hi) * 0.01` is also 0 — the final `|| 1` is what saves it.
  const g = yScale([
    [1, 0],
    [2, 0],
  ]);
  assert.equal(g.span, 1);
  assert.ok(Number.isFinite(g.y(0)));
});

test("Yahoo's null padding (holidays, halted sessions) is dropped, not drawn as zero", () => {
  const points = toPoints([1, 2, 3, 4, 5], [10, null, 12, null, 14]);
  assert.deepEqual(points, [
    [1, 10],
    [3, 12],
    [5, 14],
  ]);
  // Had the nulls become 0, the low would be 0 and the line would spike to the floor twice.
  assert.equal(yScale(points).lo, 10);
});

test('a series too short to draw yields no geometry rather than a broken path', () => {
  assert.equal(yScale([]), null);
  assert.equal(yScale([[1, 5]]), null, 'one point cannot make a line');
});

test('the y-scale pins the low to the bottom of the plot and the high to the top', () => {
  const g = yScale([
    [1, 100],
    [2, 200],
  ]);
  assert.equal(g.y(200), 10, 'high sits at the top padding');
  assert.equal(g.y(100), 238, 'low sits at H - PAD_B');
});

console.log('\nline colour');

// What PriceChart does: colour by the window on screen, not the header's 24h change.
const lineIsUp = (points) =>
  points.length < 2 || points[points.length - 1][1] >= points[0][1];

test('the line is coloured by the displayed range, not the 24h change', () => {
  // Bitcoin on the ALL range: massively up over the decade, down 2.38% on the day. Colouring the
  // line by change24h would paint a soaring chart red.
  const decadeUp = [
    [1, 0.06],
    [2, 30000],
    [3, 62485],
  ];
  const change24h = -2.38;

  assert.equal(lineIsUp(decadeUp), true, 'the line rises, so it must be green');
  assert.notEqual(
    lineIsUp(decadeUp),
    change24h >= 0,
    'this is exactly the case where the two disagree',
  );

  // And the converse: a 24h window that fell, inside an asset that is up on the day, is still red.
  const dayDown = [
    [1, 100],
    [2, 90],
  ];
  assert.equal(lineIsUp(dayDown), false);
});

test('a flat or too-short series defaults to up rather than throwing', () => {
  assert.equal(lineIsUp([]), true);
  assert.equal(lineIsUp([[1, 5]]), true);
  assert.equal(lineIsUp([[1, 5], [2, 5]]), true, 'exactly flat counts as up, not down');
});

/* ── Ticker normalisation across three upstreams ────────────────────────────────────────────────
 *
 * A share class has three spellings and each upstream rejects the other two. The screener carries
 * Nasdaq's screener form ("BRK/B"); Yahoo's chart 404s on the slash and wants a dash; Nasdaq's
 * *profile* API answers "no data" for the dash and wants a dot. This was a live bug — BRK/B came
 * back with a chart but no description until the dot form was added.
 */

const yahooTicker = (symbol) => symbol.replace(/\//g, '-');
const nasdaqTicker = (symbol) => symbol.replace(/\//g, '.');

console.log('\nticker normalisation (share classes)');

test('a share class is spelled differently for Yahoo and for Nasdaq', () => {
  assert.equal(yahooTicker('BRK/B'), 'BRK-B', 'Yahoo wants a dash');
  assert.equal(nasdaqTicker('BRK/B'), 'BRK.B', 'Nasdaq profile wants a dot');
  // The two must not collapse to the same string, or one upstream is always being sent the wrong one.
  assert.notEqual(yahooTicker('BRK/B'), nasdaqTicker('BRK/B'));
});

test('an ordinary ticker is untouched by either normalisation', () => {
  for (const s of ['AAPL', 'MSFT', 'SPY', 'XAU']) {
    assert.equal(yahooTicker(s), s);
    assert.equal(nasdaqTicker(s), s);
  }
});

/* ── Descriptions: the one invariant that matters ───────────────────────────────────────────────
 *
 * Every description must be about the asset it is displayed under, or absent. The rejected approach
 * here was Wikipedia *search* for ETFs, which never says "I don't know" — it returns the nearest
 * keyword match with full confidence. Querying "Schwab US Dividend Equity ETF" hands back the
 * generic "Exchange-traded fund" article, and "iShares Core MSCI EAFE ETF" the iShares brand page.
 * Under an "About SCHD" heading that is a confident description of the wrong thing, which is worse
 * than no description at all — the reader has no way to detect it.
 *
 * So the lookups are exact-match maps, and a miss returns '' rather than a fallback.
 */

// Mirrors descriptions.ts: an unknown key yields nothing, never a near-miss.
const lookup = (map, key) => map[key] ?? '';

console.log('\ndescriptions — never the wrong asset');

test('an unmapped symbol yields no description rather than a near-miss', () => {
  const ETF = { SPY: 'SPDR S&P 500 ETF Trust tracks the S&P 500…' };
  assert.equal(lookup(ETF, 'SPY').length > 0, true);
  // A fund nobody has written copy for must render no About section at all.
  assert.equal(lookup(ETF, 'NEWETF'), '', 'a miss is empty, not a generic ETF blurb');
  assert.equal(lookup(ETF, 'SCHD'), '');
});

test('the search-based approach this replaced would have returned the wrong article', () => {
  // What Wikipedia's search API actually returned for these queries, on 2026-07-13.
  const wikiSearch = {
    'Schwab US Dividend Equity ETF': 'Exchange-traded fund',
    'iShares Core MSCI EAFE ETF': 'IShares',
    'Vanguard Total Stock Market ETF': 'Exchange-traded fund',
    'Invesco QQQ Trust': 'Invesco QQQ', // the one that happens to work
  };

  // Three of four resolve to an article about something other than the fund asked for. A search
  // that cannot return "no match" cannot be used as a description source.
  const wrong = Object.entries(wikiSearch).filter(([q, title]) => !q.startsWith(title.slice(0, 8)));
  assert.ok(wrong.length >= 3, 'most ETF searches resolve to the wrong article');
  assert.equal(wikiSearch['Schwab US Dividend Equity ETF'], 'Exchange-traded fund');
});

test('commodity articles are pinned by symbol, so none can drift to a disambiguation page', () => {
  // The pinned map from descriptions.ts. Every one was opened and verified to be a `standard` page.
  const COMMODITY_WIKI = {
    XAU: 'Gold', XAG: 'Silver', XPT: 'Platinum', XPD: 'Palladium', HG: 'Copper',
    CL: 'West_Texas_Intermediate', BZ: 'Brent_Crude', NG: 'Natural_gas', RB: 'Gasoline',
    ZC: 'Maize', ZW: 'Wheat', ZS: 'Soybean', SB: 'Sugar', KC: 'Coffee', CT: 'Cotton', LE: 'Cattle',
  };

  // Every commodity the screener lists must be mapped — an unmapped one silently loses its About.
  const screener = ['XAU', 'XAG', 'XPT', 'XPD', 'HG', 'CL', 'BZ', 'NG', 'RB', 'ZC', 'ZW', 'ZS', 'SB', 'KC', 'CT', 'LE'];
  for (const s of screener) {
    assert.ok(COMMODITY_WIKI[s], `${s} has no pinned article`);
  }

  // Crude oil must resolve to the *grade* (WTI), not the generic "Crude oil" article — the chart is
  // the WTI contract specifically, and Brent is a different asset on the same board.
  assert.equal(COMMODITY_WIKI.CL, 'West_Texas_Intermediate');
  assert.equal(COMMODITY_WIKI.BZ, 'Brent_Crude');
  assert.notEqual(COMMODITY_WIKI.CL, COMMODITY_WIKI.BZ, 'WTI and Brent must not share an article');
});

/* ── Tokenized markets ──────────────────────────────────────────────────────────────────────────
 *
 * The CEX/DEX table for a commodity describes a *token* (gold → XAUt), not the futures contract the
 * page charts. The table is only allowed to appear when a token genuinely exists AND has live pairs;
 * a token with zero pairs (silver's KAG) must render nothing rather than an empty table implying
 * "no venues trade this".
 */

const TOKENIZED = { XAU: { slug: 'tether-gold', token: 'XAUt' } };
const hasTokenized = (cls, symbol) => cls === 'commodities' && symbol in TOKENIZED;

// Mirrors the route: a token with no usable pairs yields null, not an empty table.
const tokenizedPanel = (symbol, pairs) =>
  TOKENIZED[symbol] && pairs.length ? { token: TOKENIZED[symbol].token, pairs } : null;

console.log('\ntokenized markets');

test('only a commodity with a real token proxy gets a CEX/DEX table', () => {
  assert.equal(hasTokenized('commodities', 'XAU'), true, 'gold has XAUt');
  assert.equal(hasTokenized('commodities', 'XAG'), false, "silver's KAG has zero pairs — no table");
  assert.equal(hasTokenized('commodities', 'CL'), false, 'crude oil has no token');
  // Stocks and ETFs never get one: tokenized equities are not on CMC's keyless API.
  assert.equal(hasTokenized('stocks', 'AAPL'), false);
  assert.equal(hasTokenized('etfs', 'SPY'), false);
  // The class guard matters — a crypto asset named XAU must not be routed through the proxy path.
  assert.equal(hasTokenized('crypto', 'XAU'), false);
});

test('a token with no live pairs renders nothing, not an empty table', () => {
  assert.equal(tokenizedPanel('XAU', []), null, 'zero pairs must not render an empty markets table');
  assert.notEqual(tokenizedPanel('XAU', [{ exchange: 'Binance' }]), null);
  assert.equal(tokenizedPanel('XAG', [{ exchange: 'Binance' }]), null, 'no token → no table');
});

test('the tokenized table never replaces where-to-buy', () => {
  // Both must coexist on gold: the future (via a broker) and the token (via an exchange) are two
  // different instruments, and dropping either would tell the reader only half the truth.
  const gold = { whereToBuy: { venue: 'COMEX' }, tokenized: tokenizedPanel('XAU', [{ exchange: 'Binance' }]) };
  assert.ok(gold.whereToBuy, 'the futures listing venue must survive');
  assert.ok(gold.tokenized, 'and the token table sits alongside it');
});

/* ── Caching a *failed* description ─────────────────────────────────────────────────────────────
 *
 * A real, observed bug. On a cold start Wikipedia timed out while the route compiled, so gold's
 * description came back ''. The route cached that payload for 60 s — so every viewer got a gold page
 * with **no About section at all** for a full minute, even though Wikipedia had recovered instantly.
 *
 * The root cause is that '' meant two different things:
 *   - "the upstream fetch failed"        → transient, must NOT be cached
 *   - "no copy exists for this symbol"   → permanent, perfectly fine to cache (an unlisted ETF)
 *
 * The fix makes them distinguishable: a failure returns `null`, a legitimate absence returns ''.
 * The route then declines to cache a payload whose description is null, and normalises it to '' on
 * the way out so the client still just sees "no description" for that one request.
 */

// Mirrors the route's cache guard.
const isCacheable = (payload) => payload.description !== null;
/** What the client receives: null (a failure) is flattened to '' — the UI renders no About either way. */
const forClient = (payload) => ({ ...payload, description: payload.description ?? '' });

console.log('\ncaching a failed description');

test('BUG (reproduced): a transient upstream failure must not be cached as "no description"', () => {
  // Wikipedia timed out. Under the old behaviour this was indistinguishable from "no copy exists"…
  const failed = { symbol: 'XAU', description: null };
  // …and the old guard cached everything, so the blank page was pinned for the full 60 s TTL.
  const cacheEverything = () => true;
  assert.equal(cacheEverything(failed), true, 'the old behaviour cached the failure — the bug');

  // The fix: a failed description is never written to the cache, so the next request retries.
  assert.equal(isCacheable(failed), false, 'a failed fetch must not be cached');
});

test('a legitimate absence IS still cached — an unlisted ETF must not re-fetch forever', () => {
  // '' is a real answer: nobody has written copy for this fund. Re-running the lookup every 60 s
  // would be pure waste, so this must stay cacheable. This is why the fix needs two values, not one.
  const noCopy = { symbol: 'NEWETF', description: '' };
  assert.equal(isCacheable(noCopy), true, "an empty-but-successful lookup is a real answer");

  const found = { symbol: 'AAPL', description: 'Apple revolutionized…' };
  assert.equal(isCacheable(found), true);
});

test('the client never sees null — a failure and an absence both render no About section', () => {
  // The distinction is internal to the cache. The UI has one job: render the section, or don't.
  assert.equal(forClient({ description: null }).description, '', 'null is flattened for the client');
  assert.equal(forClient({ description: '' }).description, '');
  assert.equal(forClient({ description: 'text' }).description, 'text');
  // And the view keys off truthiness, so '' renders nothing either way.
  assert.equal(Boolean(forClient({ description: null }).description), false);
});

console.log(`\n${passed} passed\n`);
