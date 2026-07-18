// Shared types for the Reports feature — the daily/weekly/monthly market reports.
//
// A Report is fully self-contained: it carries the ranked coins, the Binance pairs, the sentiment
// snapshot and the LLM's analysis as they stood at generation time. Nothing is looked up again at
// render time, so a stored report always renders exactly as it was generated even if the upstream
// endpoints later change shape or disappear.

export type Period = 'daily' | 'weekly' | 'monthly';

export const PERIODS: Period[] = ['daily', 'weekly', 'monthly'];

export const isPeriod = (v: unknown): v is Period =>
  typeof v === 'string' && (PERIODS as string[]).includes(v);

/** How many daily candles back each period looks when deriving Binance change from klines.
 *  binance.ts is the only consumer. */
export const PERIOD_DAYS: Record<Period, number> = { daily: 1, weekly: 7, monthly: 30 };

/** A coin that survived the quality gate, ranked by its period's change. */
export interface RankedCoin {
  id: number;
  symbol: string;
  name: string;
  slug: string;
  thumb: string;
  cmcRank: number | null;
  price: number | null;
  /** Percent change over the report's period (not always 24h). */
  changePct: number;
  volume: number;
  marketCap: number;
  /** Volume as a share of market cap — the closest thing we have to a "this is unusually active"
   *  signal without historical volume. High turnover on a mid-cap is the shape we're looking for. */
  turnover: number;
}

/** A Binance USDT trading pair, ranked by its period's change. */
export interface RankedPair {
  symbol: string;
  base: string;
  changePct: number;
  lastPrice: number;
  /** 24h quote volume in USDT. Binance reports this for the last 24h only, at any period. */
  quoteVolume: number;
  /** Coin logo URL, borrowed from the CMC listing by base-symbol match at build time. Binance's
   *  API carries no logos, and bases outside CMC's top 500 stay undefined — the client falls back
   *  to an initial chip. Optional also because stored reports predate the field. */
  thumb?: string;
}

export interface Sentiment {
  fearGreed: { value: number; classification: string } | null;
  trending: string[];
  mostVisited: string[];
  recentlyAdded: string[];
}

export interface CoinThesis {
  symbol: string;
  thesis: string;
}

export interface LlmAnalysis {
  summary: string;
  coinTheses: CoinThesis[];
  riskFlags: string[];
  disclaimer: string;
}

export interface Report {
  period: Period;
  /** UTC calendar date the report covers, YYYY-MM-DD. */
  reportDate: string;
  coins: RankedCoin[];
  binancePairs: RankedPair[];
  sentiment: Sentiment;
  /** null when the LLM failed or there was nothing to analyze — never a fabricated stand-in. */
  analysis: LlmAnalysis | null;
  /** 'gemini' | 'groq' | null — which provider produced `analysis`. Surfaced as provenance. */
  llmProvider: string | null;
  generatedAt: number;
}
