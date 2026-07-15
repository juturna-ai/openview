// Pure-logic tests for the stocks leaderboard's Nasdaq row cleanup (see route.ts: cleanName,
// isCommonEquity).
//
// THE BUG (two facets, both from Nasdaq's raw screener rows):
//
//   1. cleanName strips "Class [A-Z]" and everything after it, so both share classes of the
//      same company collapse onto one display name:
//        "Alphabet Inc. Class A Common Stock"   (GOOGL) -> "Alphabet Inc."
//        "Alphabet Inc. Class C Capital Stock"  (GOOG)  -> "Alphabet Inc."
//        "Berkshire Hathaway Inc." (BRK/A) and (BRK/B)  -> identical
//      Two adjacent leaderboard rows render with the IDENTICAL name and look like duplicates.
//
//   2. Non-common-equity instruments (preferred stock, notes, warrants, rights) are included and
//      carry the PARENT company's market cap, polluting the ranking:
//        GOOGM / GOOGN  Alphabet depositary shares representing preferred stock (~$605B)
//        TBB            AT&T 5.350% Global Notes due 2066
//        BRKRP          Bruker 6.375% Mandatory Convertible Preferred Stock, Series A
//      Rows that merely CONTAIN "Units" / "Depositary" as part of a normal common-share listing
//      (SE's ADS, ET's Common Units) are legitimate and must be KEPT.
//
// The helpers live in stocks.ts rather than route.ts so this file can import them under plain
// `node` — route.ts imports `next/server`, which doesn't resolve outside a Next build.
//
// Run: node web/app/api/market/screener/route.logic.test.mjs

import assert from 'node:assert/strict';

const { cleanName, isCommonEquity } = await import('./stocks.ts');

/* ── 1. cleanName must preserve share class so adjacent rows don't collide ── */

{
  const googl = cleanName('Alphabet Inc. Class A Common Stock');
  const goog = cleanName('Alphabet Inc. Class C Capital Stock');
  assert.notEqual(googl, goog, 'GOOGL and GOOG must not render identical names');
  assert.match(googl, /Class A/i, 'GOOGL name should keep a readable "Class A" label');
  assert.match(goog, /Class C/i, 'GOOG name should keep a readable "Class C" label');
}
console.log('✓ cleanName distinguishes Alphabet Class A from Class C');

/* ── 2. cleanName still strips the generic "Common Stock" suffix cleanly ── */

{
  assert.equal(
    cleanName('NVIDIA Corporation Common Stock'),
    'NVIDIA Corporation',
    'plain common stock suffix still strips with no leftover class label',
  );
}
console.log('✓ cleanName("NVIDIA Corporation Common Stock") === "NVIDIA Corporation"');

/* ── 3. cleanName strips the "(DE)" style exchange/incorporation suffix ── */

{
  assert.equal(
    cleanName('Cisco Systems, Inc. Common Stock (DE)'),
    'Cisco Systems, Inc.',
    '(DE) incorporation suffix should be stripped along with "Common Stock"',
  );
}
console.log('✓ cleanName strips trailing "(DE)" suffix');

/* ── 3b. Berkshire: Nasdaq names both classes bare "Berkshire Hathaway Inc." and puts the class
   only in the ticker (BRK/A, BRK/B), so the symbol is the only signal available ── */

{
  const a = cleanName('Berkshire Hathaway Inc.', 'BRK/A');
  const b = cleanName('Berkshire Hathaway Inc.', 'BRK/B');
  assert.notEqual(a, b, 'BRK/A and BRK/B must not render identical names');
  assert.match(a, /Class A/i);
  assert.match(b, /Class B/i);
  // A symbol with no slash suffix must not gain a spurious class label.
  assert.equal(cleanName('NVIDIA Corporation Common Stock', 'NVDA'), 'NVIDIA Corporation');
}
console.log('✓ cleanName derives the share class from the BRK/A vs BRK/B ticker');

/* ── 4. isCommonEquity: FALSE for preferred stock / notes / mandatory convertibles ── */

{
  const rejects = [
    'Alphabet Inc. Depositary Shares representing a 1/20th Interest in a Share of Series A Mandatory Convertible Preferred Stock',
    'AT&T Inc. 5.350% Global Notes due 2066',
    'Bruker Corporation 6.375% Mandatory Convertible Preferred Stock, Series A',
  ];
  for (const name of rejects) {
    assert.equal(isCommonEquity(name), false, `expected FALSE (filtered out) for: "${name}"`);
  }
}
console.log('✓ isCommonEquity rejects GOOGM/GOOGN preferred, TBB notes, BRKRP mandatory convertible preferred');

/* ── 5. isCommonEquity: TRUE for legitimate common equity, including ADS / Common Units ── */

{
  const keepers = [
    'NVIDIA Corporation Common Stock',
    'Apple Inc. Common Stock',
    'Berkshire Hathaway Inc.',
    'Sea Limited American Depositary Shares, each representing one Class A Ordinary Share',
    'Energy Transfer LP Common Units',
  ];
  for (const name of keepers) {
    assert.equal(isCommonEquity(name), true, `expected TRUE (kept) for: "${name}"`);
  }
}
console.log('✓ isCommonEquity keeps NVDA/AAPL/BRK common stock, SE ADS, ET Common Units');

/* ── 6. End-to-end: clean + filter a small fixture of raw Nasdaq rows, then assert no two
   surviving rows share a display name (the observable symptom of the bug) ── */

{
  const rawRows = [
    { symbol: 'GOOGL', name: 'Alphabet Inc. Class A Common Stock' },
    { symbol: 'GOOG', name: 'Alphabet Inc. Class C Capital Stock' },
    { symbol: 'GOOGM', name: 'Alphabet Inc. Depositary Shares representing a 1/20th Interest in a Share of Series A Mandatory Convertible Preferred Stock' },
    { symbol: 'GOOGN', name: 'Alphabet Inc. Depositary Shares representing a 1/20th Interest in a Share of Series B Mandatory Convertible Preferred Stock' },
    // Nasdaq really does return both Berkshire classes under the bare name "Berkshire Hathaway
    // Inc." — the class lives only in the ticker, which cleanName reads as a fallback.
    { symbol: 'BRK/A', name: 'Berkshire Hathaway Inc.' },
    { symbol: 'BRK/B', name: 'Berkshire Hathaway Inc.' },
    { symbol: 'TBB', name: 'AT&T Inc. 5.350% Global Notes due 2066' },
    { symbol: 'BRKRP', name: 'Bruker Corporation 6.375% Mandatory Convertible Preferred Stock, Series A' },
    { symbol: 'SE', name: 'Sea Limited American Depositary Shares, each representing one Class A Ordinary Share' },
    { symbol: 'ET', name: 'Energy Transfer LP Common Units' },
    { symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock' },
  ];

  const surviving = rawRows
    .filter((r) => isCommonEquity(r.name))
    .map((r) => ({ symbol: r.symbol, name: cleanName(r.name, r.symbol) }));

  // The preferred/notes rows must be gone.
  const survivingSymbols = surviving.map((r) => r.symbol);
  for (const dropped of ['GOOGM', 'GOOGN', 'TBB', 'BRKRP']) {
    assert.ok(!survivingSymbols.includes(dropped), `${dropped} should have been filtered out`);
  }
  // Legitimate common equity must remain.
  for (const kept of ['GOOGL', 'GOOG', 'BRK/A', 'BRK/B', 'SE', 'ET', 'NVDA']) {
    assert.ok(survivingSymbols.includes(kept), `${kept} should have survived the filter`);
  }

  // No two surviving rows may share a display name — that's the visible symptom of the bug.
  const names = surviving.map((r) => r.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dupes, [], `surviving rows must have unique display names, found dupes: ${dupes.join(', ')}`);
}
console.log('✓ end-to-end: fixture of raw Nasdaq rows -> clean+filter -> no duplicate display names');

console.log('\nAll stocks-leaderboard cleanup tests passed.');
