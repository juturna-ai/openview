// Cleanup rules for Nasdaq's raw stock screener rows.
//
// Split out of route.ts so it can be unit-tested with plain `node` — route.ts imports `next/server`,
// which won't resolve outside a Next build.
//
// Nasdaq's screener returns every listed security, not just common equity, and it names them the way
// a prospectus would. Two consequences the leaderboard has to undo:
//
//   1. Share classes collapse. "Alphabet Inc. Class A Common Stock" (GOOGL) and "Alphabet Inc.
//      Class C Capital Stock" (GOOG) are different securities, but stripping the class suffix left
//      both rendering as "Alphabet Inc." — two adjacent rows, same name, reading as a duplicate.
//
//   2. Non-equity instruments carry the parent's market cap. GOOGM/GOOGN are Alphabet *preferred*
//      depositary shares; Nasdaq stamps them with Alphabet's full ~$600B cap, so they'd rank in the
//      top 25 as if they were a second Alphabet. Same for TBB (AT&T notes) and BRKRP (Bruker
//      mandatory convertible preferred).

/** The share-class label, if the listing names one: "…Class A Common Stock" → "Class A". */
const CLASS_RE = /\bClass ([A-Z])\b/;

/**
 * "NVIDIA Corporation Common Stock" → "NVIDIA Corporation"
 * "Alphabet Inc. Class A Common Stock" → "Alphabet Inc. (Class A)"
 * "Cisco Systems, Inc. Common Stock (DE)" → "Cisco Systems, Inc."
 * "Berkshire Hathaway Inc." + symbol "BRK/B" → "Berkshire Hathaway Inc. (Class B)"
 *
 * The class label is preserved — parenthesised so it reads as an annotation rather than part of the
 * company name — because dropping it is what made the two Alphabet rows look like duplicates.
 *
 * Berkshire is the awkward case: Nasdaq names *both* classes bare "Berkshire Hathaway Inc." and
 * encodes the class only in the ticker's slash suffix (BRK/A, BRK/B), so the symbol is the sole
 * signal available. Hence the optional second argument.
 */
export function cleanName(s: string, symbol = ''): string {
  const cls = s.match(CLASS_RE)?.[1] ?? symbol.match(/\/([A-Z])$/)?.[1];

  const base =
    s
      // The boilerplate suffix, plus anything trailing it (class labels, "(DE)", ADS wording).
      .replace(
        /\s+(Common Stock|Capital Stock|Ordinary Shares?|Common Units|Class [A-Z])\b.*$/i,
        '',
      )
      // A bare "(DE)" / "(MD)" incorporation suffix on listings with no boilerplate to anchor on.
      .replace(/\s*\([A-Z]{2}\)\s*$/, '')
      .trim() || s;

  return cls ? `${base} (Class ${cls})` : base;
}

/**
 * True for rows the stocks leaderboard should keep: common equity only.
 *
 * Rejects preferred stock, notes/bonds, warrants, rights and units-of-a-SPAC — all of which Nasdaq
 * tags with the issuer's market cap and would otherwise rank as a second copy of the company.
 *
 * Deliberately narrow: it matches the *instrument* wording, never the word "Depositary" alone.
 * Sea Limited's "American Depositary Shares, each representing one Class A Ordinary Share" and
 * Energy Transfer's "Common Units" are ordinary common equity and must survive.
 */
export function isCommonEquity(name: string): boolean {
  return !/(Preferred|Warrant|\bRights?\b|\bNotes?\b|\bBonds?\b|\bDebenture|Subordinated|% .*due \d{4})/i.test(
    name,
  );
}
