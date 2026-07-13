// The CEX/DEX markets table for a *non-crypto* asset — where one legitimately exists.
//
// The premise has to be stated carefully, because it is easy to build a lie here.
//
// A crude-oil future does not trade on Binance, and it does not trade on Uniswap. "CEX" and "DEX"
// are crypto-native venue types, and no keyless source publishes per-venue price, depth or volume
// for an equity or a futures contract in any case — Yahoo reports exactly *one* exchange per
// instrument (NasdaqGS, NYSEArca, NY Mercantile), because in US equities every broker fills against
// the same consolidated quote. A price/depth/volume table for AAPL or CL would have to be invented
// column by column, which is precisely why `WhereToBuy` exists instead.
//
// What *is* real: some of these assets have a **tokenized proxy** — an ERC-20 redeemable for the
// underlying, which genuinely trades on centralised and decentralised crypto exchanges, and for
// which CoinMarketCap publishes a genuine market-pairs table. Tether Gold (XAUt) is one token
// backed by one troy ounce of gold; it trades on Binance, OKX, Bybit and Uniswap, with real prices
// and real depth that track spot gold closely.
//
// So this module answers a strictly narrower question than the crypto markets table does. Not
// "where does gold trade" — it's "where does a gold-backed *token* trade". Those are different
// instruments with different counterparty risk, and the UI must say so rather than let the reader
// assume the rows describe the futures contract they were just looking at.
//
// Coverage is deliberately thin. Only assets whose token was verified to have live, non-outlier
// pairs on CMC appear below. Silver's Kinesis token (KAG) resolves but has *zero* market pairs, so
// silver is absent rather than present-and-empty. Tokenized US equities (the xStocks family) are
// not on CMC's keyless API at all, so no stock or ETF has an entry here — and that is why this map
// is keyed only by commodity symbol.

import type { MarketPair } from './route';

/**
 * Commodity symbol → the tokenized instrument that stands in for it.
 *
 * `slug` is CMC's, which its market-pairs endpoint keys off. Both entries here were verified live
 * against that endpoint; anything that cannot be verified does not get added.
 *
 * Gold has two credible tokens (Tether Gold and Paxos Gold). XAUt wins the slot on liquidity — ~200
 * pairs against PAXG's ~164, deeper CEX volume, and it carries genuine DEX rows (a PAXG/XAUt pool
 * on Uniswap v3), where PAXG's own pairs are almost entirely centralised. One token per commodity
 * keeps the table honestly attributable: every row is a market in *this* named instrument.
 */
export const TOKENIZED: Record<
  string,
  {
    /** CMC slug — the key its market-pairs endpoint requires. */
    slug: string;
    /** The token's ticker, shown to the reader so the substitution is never silent. */
    token: string;
    /** The token's full name, for the panel's disclosure line. */
    tokenName: string;
    /** What one unit is redeemable for — the sentence that makes the proxy legible. */
    backing: string;
  }
> = {
  XAU: {
    slug: 'tether-gold',
    token: 'XAUt',
    tokenName: 'Tether Gold',
    backing: 'one troy ounce of physical gold held in a Swiss vault',
  },
};

/** Metadata for the UI's disclosure, plus the pairs themselves. Null when the asset has no token. */
export interface TokenizedMarkets {
  token: string;
  tokenName: string;
  backing: string;
  pairs: MarketPair[];
  total: number;
}

/** Whether this asset has a tokenized proxy at all — cheap enough to check before fetching. */
export const hasTokenized = (cls: string, symbol: string): boolean =>
  cls === 'commodities' && symbol in TOKENIZED;
