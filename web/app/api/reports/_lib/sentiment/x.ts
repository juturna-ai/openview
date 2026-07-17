// The X (Twitter) seam — deliberately unimplemented.
//
// The original ask was to read what people are saying on X and fold that into each report. X has no
// free read tier: the Basic plan starts around $100/month, so this is a spending decision, not a
// coding one. Until that's made, the report leans on the free crowd-attention proxies already
// wired up in cmc.ts (trending / most-visited / recently-added) plus Fear & Greed.
//
// This file exists so that decision stays cheap to reverse. `fetchXSentiment` already has the shape
// build.ts would call, and returns null today. To turn it on:
//
//   1. Add X_BEARER_TOKEN to web/.env.local (server-side only — never NEXT_PUBLIC_*).
//   2. Implement the body against GET /2/tweets/search/recent
//      (https://api.x.com/2/tweets/search/recent?query=...&max_results=...).
//      A per-symbol cashtag query ($NEAR) with `-is:retweet lang:en` is the usual starting point.
//   3. Call it from build.ts and widen the Sentiment type with the field it returns.
//
// A caution worth recording for whoever does that: raw cashtag volume is heavily astroturfed —
// paid promotion and bots cluster hardest on exactly the low-cap coins the quality gate already
// screens out. Mention *counts* alone would make the report more confident and less correct. If
// this gets built, weight by author reputation or dedupe near-identical text, and treat it as one
// more signal rather than the causal explanation it superficially resembles.

export interface XSentiment {
  symbol: string;
  /** Matching posts in the window. */
  mentions: number;
  /** -1..1, or null if not computed. */
  score: number | null;
}

/** Returns null while X is unconfigured — callers must treat null as "no signal", not "no chatter". */
export async function fetchXSentiment(_symbols: string[]): Promise<XSentiment[] | null> {
  return null;
}
