// Wallet holdings — localStorage persistence.
//
// Mirrors journal/trades.ts: same coerce/load/save/add/delete shape, same "re-read before write so a
// second tab isn't clobbered" rule. Field names follow Reach's snake_case holding record so the data
// stays portable with the desktop app.

import type { AssetType } from './assets';

export interface Holding {
  id: number;
  symbol: string;
  name: string;
  asset_type: AssetType;
  amount: number;
  /** 0 when unknown — every P&L figure is suppressed rather than shown as a 100% gain. */
  avg_buy_price: number;
  /** Epoch ms the purchase was made. Absent on records written before this field existed. */
  purchased_at?: number;
  /** Trading fee paid, as a percent of trade value (0.5 = 0.5%). */
  fee_pct?: number;
  /** Free-form user note. */
  notes?: string;
}

export const HOLDINGS_KEY = 'ov_holdings';

const ASSET_TYPES: AssetType[] = ['crypto', 'stock', 'metal', 'currency'];

/** Narrows unknown localStorage JSON to a Holding, coercing the numeric fields. */
function coerce(raw: unknown): Holding | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.symbol !== 'string' || !h.symbol) return null;
  if (!ASSET_TYPES.includes(h.asset_type as AssetType)) return null;
  const num = (v: unknown, fallback = 0) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  // The three fields below post-date the original record shape, so they stay optional: a holding
  // saved before they existed loads with them undefined rather than being rejected outright.
  const optNum = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return {
    id: num(h.id),
    symbol: h.symbol,
    name: typeof h.name === 'string' ? h.name : h.symbol,
    asset_type: h.asset_type as AssetType,
    amount: num(h.amount),
    avg_buy_price: num(h.avg_buy_price),
    purchased_at: optNum(h.purchased_at),
    fee_pct: optNum(h.fee_pct),
    notes: typeof h.notes === 'string' ? h.notes : undefined,
  };
}

// Which storage key the zero-arg helpers below read/write. Defaults to the legacy single-list key;
// portfolios.ts points it at the active portfolio's key via setActiveHoldingsKey(). Keeping the
// original functions key-agnostic means every existing caller (loadHoldings/addHolding/…) works
// unchanged — it just operates on whichever portfolio is active.
let activeKey = HOLDINGS_KEY;

/** Repoint the zero-arg helpers at a specific portfolio's holdings key. */
export function setActiveHoldingsKey(key: string): void {
  activeKey = key;
}

/** Reads holdings from an explicit key. Returns [] on the server or on missing/corrupt data. */
export function loadHoldingsFrom(key: string): Holding[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerce).filter((h): h is Holding => h !== null);
  } catch {
    return [];
  }
}

/** Writes holdings to an explicit key. Silently no-ops if storage is unavailable/full. */
export function saveHoldingsTo(key: string, holdings: Holding[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(holdings));
  } catch {
    /* storage blocked or quota exceeded — keep the in-memory list rather than throwing */
  }
}

/** Reads all holdings. Returns [] on the server, on missing/corrupt data, or if storage is blocked. */
export function loadHoldings(): Holding[] {
  return loadHoldingsFrom(activeKey);
}

/** Writes the full list back. Silently no-ops if storage is unavailable/full. */
export function saveHoldings(holdings: Holding[]): void {
  saveHoldingsTo(activeKey, holdings);
}

export function addHolding(holding: Omit<Holding, 'id'>): Holding[] {
  const existing = loadHoldings();
  const id = existing.reduce((max, h) => Math.max(max, h.id), 0) + 1;
  const next = [...existing, { ...holding, id }];
  saveHoldings(next);
  return next;
}

export function updateHolding(id: number, patch: Partial<Omit<Holding, 'id'>>): Holding[] {
  const next = loadHoldings().map((h) => (h.id === id ? { ...h, ...patch } : h));
  saveHoldings(next);
  return next;
}

export function deleteHolding(id: number): Holding[] {
  const next = loadHoldings().filter((h) => h.id !== id);
  saveHoldings(next);
  return next;
}

// ── Portfolio history ──
// Reach records portfolio-value snapshots to SQLite and reads them back for the History chart. With
// no server DB here, snapshots go to localStorage on each successful price poll — which is why the
// chart legitimately shows "Collecting data" until a couple of polls have landed.

export interface Snapshot {
  /** Epoch ms. */
  t: number;
  value: number;
}

export const SNAPSHOTS_KEY = 'ov_portfolio_snapshots';

/** One snapshot every 5 min is plenty for a 24h..All chart, and keeps the row count sane. */
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
/** ~90 days at 5-min spacing, the longest bounded range the chart offers. */
const MAX_SNAPSHOTS = 26_000;

export function loadSnapshots(): Snapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Snapshot =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as Snapshot).t === 'number' &&
        typeof (s as Snapshot).value === 'number' &&
        Number.isFinite((s as Snapshot).value),
    );
  } catch {
    return [];
  }
}

/** How far back a snapshot may sit from the target and still anchor the change figure. */
const CHANGE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * Value of the portfolio `hoursAgo` hours back, or null when history doesn't reach that far.
 *
 * Returns null rather than falling back to the oldest snapshot: differencing a fresh portfolio
 * against its own first reading reports the opening balance as a gain, which is how a $63k wallet
 * ends up claiming "24h +$63k" on day one. A dash is the honest answer until the history exists.
 */
export function valueAgo(snapshots: Snapshot[], hoursAgo: number, now = Date.now()): number | null {
  if (snapshots.length === 0) return null;
  const target = now - hoursAgo * 3600_000;
  // Snapshots are appended in time order, so the last one at/before the target is the anchor.
  let anchor: Snapshot | null = null;
  for (const s of snapshots) {
    if (s.t <= target) anchor = s;
    else break;
  }
  if (!anchor) return null;
  // A stale anchor (portfolio untouched for days) would date the "24h" change by however long the
  // gap runs — treat anything well outside the window as no data.
  if (target - anchor.t > CHANGE_TOLERANCE_MS) return null;
  return anchor.value;
}

/**
 * Appends a snapshot, throttled to one per SNAPSHOT_INTERVAL_MS. Returns the full list so the caller
 * can render without a re-read.
 */
export function recordSnapshot(value: number): Snapshot[] {
  if (typeof window === 'undefined' || !Number.isFinite(value) || value <= 0) return loadSnapshots();
  const existing = loadSnapshots();
  const now = Date.now();
  const last = existing[existing.length - 1];
  if (last && now - last.t < SNAPSHOT_INTERVAL_MS) return existing;

  const next = [...existing, { t: now, value }].slice(-MAX_SNAPSHOTS);
  try {
    window.localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(next));
  } catch {
    /* storage full — the in-memory series still renders this session */
  }
  return next;
}
