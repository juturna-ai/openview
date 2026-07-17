// Trade journal data model + localStorage persistence.
//
// Mirrors the trade shape used by the Reach desktop app (snake_case columns from its SQLite
// `trades` table) so trades stay portable between the two. Trades live in localStorage under
// `ov_trades`, matching how the chart engine persists watchlists/drawings/alerts — there is no
// auth or server DB in this app.

export type TradeDirection = 'long' | 'short';
export type TradeType = 'spot' | 'futures';
export type AssetClass = 'stocks' | 'futures' | 'forex' | 'crypto' | 'options';

export interface Trade {
  id: number;
  /** 'YYYY-MM-DD' — a plain local date string, never a Date/UTC timestamp. */
  trade_date: string;
  symbol: string;
  direction: TradeDirection;
  asset_class: AssetClass;
  entry_price: number;
  exit_price: number;
  /** Margin (collateral) in USD; notional exposure = position_size × margin (leverage). */
  position_size: number;
  /** Realized P&L, already net of commissions. 0 while the trade is open. */
  pnl: number;
  commissions: number;
  /** Leverage multiplier; 1 for spot. */
  margin: number;
  trade_type: TradeType;
  /** Quantity of the underlying — spot only, null for futures. */
  amount_asset: number | null;
  /** Open positions are excluded from every P&L aggregate, but still counted as trades. */
  is_open: boolean;
  setup_tag: string | null;
  notes: string | null;
}

export const TRADES_KEY = 'ov_trades';

/** Narrows unknown localStorage JSON to a Trade, coercing the numeric fields. */
function coerce(raw: unknown): Trade | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.trade_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.trade_date)) return null;
  const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    id: num(t.id),
    trade_date: t.trade_date,
    symbol: typeof t.symbol === 'string' ? t.symbol : '',
    direction: t.direction === 'short' ? 'short' : 'long',
    asset_class: (['stocks', 'futures', 'forex', 'crypto', 'options'] as const).includes(
      t.asset_class as AssetClass,
    )
      ? (t.asset_class as AssetClass)
      : 'stocks',
    entry_price: num(t.entry_price),
    exit_price: num(t.exit_price),
    position_size: num(t.position_size),
    pnl: num(t.pnl),
    commissions: num(t.commissions),
    margin: num(t.margin, 1),
    trade_type: t.trade_type === 'spot' ? 'spot' : 'futures',
    amount_asset: typeof t.amount_asset === 'number' ? t.amount_asset : null,
    is_open: Boolean(t.is_open),
    setup_tag: typeof t.setup_tag === 'string' ? t.setup_tag : null,
    notes: typeof t.notes === 'string' ? t.notes : null,
  };
}

/** Reads all trades. Returns [] on the server, on missing/corrupt data, or if storage is blocked. */
export function loadTrades(): Trade[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TRADES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerce).filter((t): t is Trade => t !== null);
  } catch {
    return [];
  }
}

/** Writes the full trade list back. Silently no-ops if storage is unavailable/full. */
export function saveTrades(trades: Trade[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TRADES_KEY, JSON.stringify(trades));
  } catch {
    /* storage blocked or quota exceeded — keep the in-memory list rather than throwing */
  }
}

/**
 * Appends a trade and returns the new list. The id is derived from the current max so it stays
 * unique without a counter, and re-reading storage first means a write from another tab isn't
 * clobbered by a stale in-memory copy.
 */
export function addTrade(trade: Omit<Trade, 'id'>): Trade[] {
  const existing = loadTrades();
  const id = existing.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  const next = [...existing, { ...trade, id }];
  saveTrades(next);
  return next;
}

/** Removes a trade by id and returns the new list. */
export function deleteTrade(id: number): Trade[] {
  const next = loadTrades().filter((t) => t.id !== id);
  saveTrades(next);
  return next;
}

/**
 * Realized P&L from price movement, net of commissions.
 *
 * `size` is the **margin** (collateral committed), and `leverage` multiplies it into the notional
 * exposure — so a $1k margin at 10× moving 100→110 nets the same as a $10k un-leveraged position
 * ($1,000). Quantity of the underlying is (margin × leverage) / entry. An open trade has no P&L; a
 * trade with no entry/size has only its commission cost.
 */
export function computePnl(
  entry: number,
  exit: number,
  size: number,
  direction: TradeDirection,
  commissions: number,
  leverage = 1,
): number {
  if (!entry || !size) return -commissions;
  const lev = leverage > 0 ? leverage : 1;
  const qty = (size * lev) / entry;
  const move = direction === 'long' ? exit - entry : entry - exit;
  return qty * move - commissions;
}
