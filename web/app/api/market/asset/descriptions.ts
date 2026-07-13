// "About this asset" copy for the three non-crypto classes. Crypto doesn't appear here — CMC ships a
// description with its detail payload, so that class is already served upstream.
//
// The three classes get their text from three different places, and the split is forced by what
// actually exists behind a keyless endpoint:
//
//   stocks       Nasdaq's `company/{sym}/company-profile` — a real, per-company description,
//                maintained by the listing venue. Fetched live (see `stockDescription`).
//
//   commodities  Wikipedia REST, by *hardcoded article title*. There are only 16 commodities, so
//                each is pinned to the article a human checked. See COMMODITY_WIKI below for why
//                this is a fixed map and not a search.
//
//   etfs         Hardcoded here. No keyless source publishes per-fund copy: Nasdaq's profile
//                endpoint rejects the ETF asset class outright ("Unsupported Asset Class"), and
//                Wikipedia only has articles for a famous handful. See ETF_DESCRIPTIONS.
//
// The rule every one of these obeys: a description is either *about this exact asset* or it is
// absent. A plausible-looking paragraph about the wrong thing is worse than an empty section,
// because the reader has no way to tell it's wrong.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TIMEOUT_MS = 8_000;

/* ── Stocks: Nasdaq's company profile ── */

interface NasdaqProfile {
  data?: {
    CompanyDescription?: { value?: string | null };
  } | null;
}

/**
 * Nasdaq writes a share class with a **dot** ("BRK.B"); the screener carries the slash form
 * ("BRK/B") and Yahoo wants a dash ("BRK-B"). All three spellings are the same security, and each
 * upstream rejects the other two — Nasdaq answers "no data" for BRK-B and 404s on the encoded
 * slash. `yahooTicker` in route.ts does the dash half of this; this is the dot half.
 */
const nasdaqTicker = (symbol: string) => symbol.replace(/\//g, '.');

/**
 * The two ways a description can be missing, which the caller **must** be able to tell apart:
 *
 *   `''`    the source answered, and has no copy for this symbol. A real, permanent answer —
 *           safe to cache, and re-fetching it every minute would be pure waste.
 *   `null`  the fetch failed (timeout, non-200, malformed body). Transient, and caching it pins a
 *           blank About section on the page for the whole TTL even after the upstream recovers.
 *
 * This distinction exists because collapsing both to `''` was a real, observed bug: Wikipedia timed
 * out during a cold start, gold's empty payload was cached for 60 s, and every viewer got a page
 * with no About section long after Wikipedia was healthy again.
 */
export type Description = string | null;

/**
 * The company's own description of itself, via the venue that lists it.
 *
 * Never throws — the About section is supplementary, and a dead Nasdaq must cost the blurb, never
 * the page. But it distinguishes "Nasdaq has nothing for this ticker" (`''`) from "Nasdaq didn't
 * answer" (`null`), so the route knows which of the two is safe to cache.
 */
export async function stockDescription(symbol: string): Promise<Description> {
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/company/${encodeURIComponent(nasdaqTicker(symbol))}/company-profile`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    // A non-200 is a failure, not an answer — the ticker may well have a profile we simply didn't get.
    if (!res.ok) return null;

    const d = (await res.json()) as NasdaqProfile;
    // A 200 with no CompanyDescription IS an answer: Nasdaq genuinely has no profile copy for it.
    return (d?.data?.CompanyDescription?.value ?? '').trim();
  } catch {
    return null;
  }
}

/* ── Commodities: Wikipedia, by pinned article title ── */

/**
 * Commodity symbol → the exact Wikipedia article. **Hardcoded on purpose.**
 *
 * Wikipedia's search API cannot be trusted to resolve these: it always returns *something*, and
 * that something is regularly the wrong article rather than no article. It has no notion of "I
 * don't cover this" — it just hands back the nearest keyword match with full confidence.
 *
 * These 16 titles were each opened and checked. Every one resolves to a `standard` page (not a
 * disambiguation stub), so the fetch below can treat anything else as a miss.
 *
 * The metals resolve to chemistry-first articles ("Gold is a chemical element…"), which reads oddly
 * next to a futures chart but is not *wrong* — and the trading context is already supplied by the
 * price, the stats grid and the contract's listing venue. Correct-but-dry beats confidently-wrong.
 */
const COMMODITY_WIKI: Record<string, string> = {
  XAU: 'Gold',
  XAG: 'Silver',
  XPT: 'Platinum',
  XPD: 'Palladium',
  HG: 'Copper',
  CL: 'West_Texas_Intermediate',
  BZ: 'Brent_Crude',
  NG: 'Natural_gas',
  RB: 'Gasoline',
  ZC: 'Maize',
  ZW: 'Wheat',
  ZS: 'Soybean',
  SB: 'Sugar',
  KC: 'Coffee',
  CT: 'Cotton',
  LE: 'Cattle',
};

interface WikiSummary {
  type?: string;
  extract?: string;
}

/**
 * The lead paragraph of the pinned article.
 *
 * A symbol with no entry in the map returns '' rather than falling back to a search — an unmapped
 * commodity is a commodity nobody has checked, and guessing is the one thing this must not do. That
 * is a permanent answer, so it caches. A *fetch failure* returns null and does not — see
 * `Description`.
 */
export async function commodityDescription(symbol: string): Promise<Description> {
  const title = COMMODITY_WIKI[symbol];
  // Unmapped: a real, permanent "no" — no amount of retrying will produce an article.
  if (!title) return '';

  try {
    // The title comes from the hardcoded map above, never from user input, but encode it anyway:
    // the map is edited by hand and a future entry with a space or an ampersand would otherwise
    // build a malformed URL. Costs nothing; removes a whole class of future footgun.
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    // Includes the timeouts and 5xxs that caused the cached-blank-page bug.
    if (!res.ok) return null;

    const d = (await res.json()) as WikiSummary;
    // `standard` is a real article. A redirect to a disambiguation page (or a missing one) arrives
    // with a different type, and its extract would be a list of unrelated meanings. Wikipedia
    // answered, and the answer is "nothing usable" — permanent, so ''.
    if (d?.type !== 'standard') return '';

    return (d.extract ?? '').trim();
  } catch {
    return null;
  }
}

/* ── ETFs: hardcoded, because nothing keyless publishes them ── */

/**
 * Fund symbol → what the fund actually holds.
 *
 * Written by hand, matching the screener's ETF list. This is the deliberate choice over the two
 * alternatives, both of which were tried and rejected:
 *
 *   - **Nasdaq's profile endpoint** returns `{"status":{"rCode":400,...,"Unsupported Asset Class"}}`
 *     for every ETF. It is a company-profile API and a fund is not a company.
 *
 *   - **Wikipedia search** is actively harmful here. Querying "Schwab US Dividend Equity ETF"
 *     returns the *generic* "Exchange-traded fund" article; "iShares Core MSCI EAFE ETF" returns
 *     the iShares *brand* page. Rendered under an "About SCHD" heading, that is a confident
 *     description of the wrong thing — the exact failure this file exists to prevent.
 *
 * The cost is that a new ETF on the screener's list lands here with no description until someone
 * writes one. That's the intended failure mode: the section is simply absent, never wrong.
 *
 * Each entry states the index tracked and the exposure, which is the question someone opening an
 * ETF page is actually asking.
 */
const ETF_DESCRIPTIONS: Record<string, string> = {
  SPY: 'SPDR S&P 500 ETF Trust is the oldest and most heavily traded US exchange-traded fund, launched in 1993. It tracks the S&P 500, an index of about 500 large-cap US companies weighted by market capitalisation, and is structured as a unit investment trust.',
  VOO: 'Vanguard S&P 500 ETF tracks the S&P 500 index of large-cap US companies. It offers the same exposure as older S&P 500 funds at one of the lowest expense ratios in the category, which is what drove its rise to become one of the largest ETFs in the world.',
  IVV: 'iShares Core S&P 500 ETF tracks the S&P 500 index of large-cap US companies. It is BlackRock’s core S&P 500 vehicle, positioned as a low-cost, long-term holding rather than a trading instrument.',
  VTI: 'Vanguard Total Stock Market ETF holds essentially the entire investable US equity market — large, mid, small and micro-cap companies — rather than just the large-cap tier tracked by an S&P 500 fund. It is a common single-fund proxy for "US stocks".',
  QQQ: 'Invesco QQQ Trust tracks the Nasdaq-100, the largest hundred non-financial companies listed on the Nasdaq exchange. Because Nasdaq listings skew heavily toward technology, the fund is widely used as a proxy for large-cap US tech.',
  VUG: 'Vanguard Growth ETF holds the growth half of the US large-cap market — companies screened for high earnings and sales growth rather than low valuation. It is the counterpart to Vanguard Value ETF (VTV).',
  VEA: 'Vanguard FTSE Developed Markets ETF holds large, mid and small-cap stocks in developed markets outside the United States, spanning Europe, Japan, Canada and the Pacific. It is a common way to add non-US developed exposure to a US-heavy portfolio.',
  IEFA: 'iShares Core MSCI EAFE ETF tracks developed-market equities across Europe, Australasia and the Far East — the "EAFE" region, which by definition excludes the United States and Canada.',
  VTV: 'Vanguard Value ETF holds the value half of the US large-cap market — companies trading at low multiples of earnings, book value and sales. It is the counterpart to Vanguard Growth ETF (VUG).',
  BND: 'Vanguard Total Bond Market ETF holds a broad cross-section of investment-grade US bonds: Treasuries, government agency debt, corporate bonds and mortgage-backed securities. It is a common single-fund proxy for "US bonds".',
  AGG: 'iShares Core U.S. Aggregate Bond ETF tracks the Bloomberg US Aggregate Bond Index, the standard benchmark for the investment-grade US bond market. It is BlackRock’s counterpart to Vanguard’s BND.',
  IWF: 'iShares Russell 1000 Growth ETF holds the growth-classified companies within the Russell 1000, an index of the thousand largest US firms. Its holdings skew toward technology and consumer names with high growth rates.',
  IJH: 'iShares Core S&P Mid-Cap ETF tracks the S&P MidCap 400 — US companies too small for the S&P 500 but well established, sitting between the large-cap and small-cap tiers.',
  VIG: 'Vanguard Dividend Appreciation ETF holds US companies with a long record of *increasing* their dividends year after year, rather than simply paying a high one. The screen tends to favour established, profitable businesses.',
  IWM: 'iShares Russell 2000 ETF tracks the Russell 2000, the standard benchmark for US small-cap stocks. It is widely watched as a read on the health of smaller, more domestically focused American companies.',
  VXUS: 'Vanguard Total International Stock ETF holds equities from essentially every market outside the United States — both developed and emerging. Paired with VTI, the two cover the global stock market.',
  VWO: 'Vanguard FTSE Emerging Markets ETF holds stocks in emerging economies such as China, India, Taiwan, Brazil and South Africa. Emerging-market equities carry higher volatility and higher political risk than developed markets.',
  GLD: 'SPDR Gold Shares is backed by physical gold bullion held in vaults, giving stock-market exposure to the gold price without the holder taking delivery of metal or trading futures. It is the largest gold-backed ETF.',
  IAU: 'iShares Gold Trust holds physical gold bullion, tracking the metal’s spot price. It offers the same exposure as SPDR Gold Shares (GLD) at a lower expense ratio, in a smaller share denomination.',
  SLV: 'iShares Silver Trust holds physical silver bullion in vaults, tracking the metal’s spot price. Silver is both a precious metal and an industrial input, so it tends to be more volatile than gold.',
  IEMG: 'iShares Core MSCI Emerging Markets ETF holds large, mid and small-cap stocks across emerging economies. It is BlackRock’s low-cost core emerging-markets vehicle, and a direct competitor to Vanguard’s VWO.',
  IWD: 'iShares Russell 1000 Value ETF holds the value-classified companies within the Russell 1000, tilting toward financials, healthcare and industrials trading at lower valuation multiples.',
  SCHD: 'Schwab US Dividend Equity ETF screens US companies for both a sustained record of paying dividends and underlying financial strength, rather than chasing the highest yield available. It is popular with income-focused investors.',
  DIA: 'SPDR Dow Jones Industrial Average ETF tracks the Dow Jones Industrial Average, thirty large US companies. Unusually, the Dow is *price-weighted*, so a stock’s share price — not its size — determines its influence on the index.',
  RSP: 'Invesco S&P 500 Equal Weight ETF holds the same companies as the S&P 500 but weights each one equally, rather than by market capitalisation. That reduces the dominance of the largest few names and tilts the fund toward mid-caps.',
  XLK: 'Technology Select Sector SPDR holds the technology companies within the S&P 500 — software, semiconductors and hardware. It is a concentrated sector bet, so its top holdings carry very large weights.',
  XLF: 'Financial Select Sector SPDR holds the financial companies within the S&P 500: banks, insurers, asset managers and exchanges. It is closely watched as a read on interest rates and credit conditions.',
  XLE: 'Energy Select Sector SPDR holds the energy companies within the S&P 500, dominated by integrated oil majors and oilfield services. Its performance tracks crude oil prices far more closely than the broad market does.',
  XLV: 'Health Care Select Sector SPDR holds the healthcare companies within the S&P 500: pharmaceuticals, insurers, medical devices and life-science tools.',
  SMH: 'VanEck Semiconductor ETF holds the largest semiconductor companies — chip designers, manufacturers and the equipment makers that supply them. It is a highly concentrated, notably volatile slice of the technology sector.',
  SOXX: 'iShares Semiconductor ETF tracks US-listed semiconductor companies, covering chip design, fabrication and equipment. It is a direct competitor to VanEck’s SMH, differing mainly in index rules and weighting caps.',
  ARKK: 'ARK Innovation ETF is an *actively managed* fund — unlike most ETFs on this list, it follows no index. Its managers concentrate holdings in companies they judge to be "disruptive innovators", which has produced dramatic swings in both directions.',
  TLT: 'iShares 20+ Year Treasury Bond ETF holds long-dated US Treasury bonds. Because bond prices move inversely to yields, and long-dated bonds are the most rate-sensitive of all, this fund is effectively a direct bet on falling long-term interest rates.',
  HYG: 'iShares iBoxx High Yield Corporate Bond ETF holds "junk" bonds — corporate debt rated below investment grade. It pays more than an investment-grade fund in exchange for real default risk, and trades more like equities in a crisis.',
  LQD: 'iShares iBoxx Investment Grade Corporate Bond ETF holds the debt of financially sound corporations rated investment grade. It yields more than Treasuries in exchange for modest credit risk.',
  EFA: 'iShares MSCI EAFE ETF holds large and mid-cap developed-market stocks across Europe, Australasia and the Far East. It is the older, pricier sibling of IEFA, which tracks the same region.',
  EEM: 'iShares MSCI Emerging Markets ETF holds large and mid-cap stocks in emerging economies. It is the older, more heavily traded emerging-markets fund, favoured by traders, while IEMG targets long-term holders at a lower cost.',
  IBIT: 'iShares Bitcoin Trust holds bitcoin directly, giving exposure to its price through an ordinary brokerage account without the holder custodying keys or using a crypto exchange. It launched in January 2024 among the first US spot bitcoin ETFs.',
  FBTC: 'Fidelity Wise Origin Bitcoin Fund holds bitcoin directly, tracking its price in a conventional brokerage account. Fidelity custodies the underlying bitcoin itself rather than delegating to a third party.',
  VYM: 'Vanguard High Dividend Yield ETF holds US companies that pay above-average dividends, tilting toward established firms in financials, consumer staples, healthcare and energy.',
};

/** The fund's description, or '' when nobody has written one for this symbol yet. */
export function etfDescription(symbol: string): string {
  return ETF_DESCRIPTIONS[symbol] ?? '';
}
