// Multi-portfolio storage — a thin index over the existing per-holding store.
//
// The wallet used to keep a single holdings list under `ov_holdings`. This adds named portfolios on
// top WITHOUT moving that data: the original `ov_holdings` becomes the first portfolio's holdings,
// and every additional portfolio stores its holdings under `ov_holdings__<id>`. A tiny index
// (`ov_portfolios`) records the names, order, and which one is active.
//
// Why not one big blob: keeping each portfolio's holdings in its own key means holdings.ts's
// load/save/add/update/delete primitives keep working unchanged — they just read/write whichever key
// is active. The migration below is one-way and idempotent, and it never deletes the legacy key, so
// a downgrade still finds the user's original holdings exactly where they were.

import {
  type Holding,
  HOLDINGS_KEY,
  loadHoldingsFrom,
  saveHoldingsTo,
  setActiveHoldingsKey,
  setActiveSnapshotsKey,
  SNAPSHOTS_KEY,
} from './holdings';

export interface PortfolioMeta {
  id: string;
  name: string;
  /** Emoji shown as the portfolio avatar. Absent on records written before this field existed. */
  avatar?: string;
}

/** Default avatar for portfolios that haven't picked one. */
export const DEFAULT_AVATAR = '👻';

interface PortfolioIndex {
  portfolios: PortfolioMeta[];
  activeId: string;
}

export const PORTFOLIOS_KEY = 'ov_portfolios';

/** The id given to the portfolio migrated out of the legacy `ov_holdings` key. */
export const LEGACY_PORTFOLIO_ID = 'main';
const DEFAULT_NAME = 'My Portfolio';

/** Per-portfolio holdings live here; the legacy portfolio keeps using `ov_holdings` untouched. */
export function holdingsKeyFor(id: string): string {
  return id === LEGACY_PORTFOLIO_ID ? HOLDINGS_KEY : `${HOLDINGS_KEY}__${id}`;
}

/** Per-portfolio value-history key; main keeps the legacy `ov_portfolio_snapshots` so its history survives. */
export function snapshotsKeyFor(id: string): string {
  return id === LEGACY_PORTFOLIO_ID ? SNAPSHOTS_KEY : `${SNAPSHOTS_KEY}__${id}`;
}

/** Point holdings.ts's zero-arg helpers at a portfolio's holdings AND snapshots keys together. */
function pointAt(id: string): void {
  setActiveHoldingsKey(holdingsKeyFor(id));
  setActiveSnapshotsKey(snapshotsKeyFor(id));
}

/** A monotonic-ish id without Date.now (unavailable in some sandboxes) — good enough for a local key. */
function newId(existing: PortfolioMeta[]): string {
  let n = existing.length + 1;
  const ids = new Set(existing.map((p) => p.id));
  while (ids.has(`p${n}`)) n++;
  return `p${n}`;
}

function coerceIndex(raw: unknown): PortfolioIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.portfolios)) return null;
  const portfolios = o.portfolios
    .filter((p): p is PortfolioMeta => !!p && typeof p === 'object')
    .map((p) => {
      const meta = p as PortfolioMeta;
      const avatar = typeof meta.avatar === 'string' && meta.avatar ? meta.avatar : undefined;
      return { id: String(meta.id), name: String(meta.name), ...(avatar ? { avatar } : {}) };
    })
    .filter((p) => p.id && p.name);
  if (portfolios.length === 0) return null;
  const activeRaw = typeof o.activeId === 'string' ? o.activeId : '';
  // A dangling activeId (portfolio was deleted out from under it) falls back to the first entry.
  const activeId = portfolios.some((p) => p.id === activeRaw) ? activeRaw : portfolios[0].id;
  return { portfolios, activeId };
}

function readIndex(): PortfolioIndex | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PORTFOLIOS_KEY);
    if (!raw) return null;
    return coerceIndex(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeIndex(idx: PortfolioIndex): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(idx));
  } catch {
    /* storage blocked/full — the in-memory index still drives this session */
  }
}

/**
 * Ensures a portfolio index exists, creating one from the legacy single-list state on first run.
 * Idempotent: once the index is written, later calls just return it. The legacy `ov_holdings` key is
 * left in place and simply becomes the "main" portfolio's holdings key.
 */
export function ensurePortfolios(): PortfolioIndex {
  const existing = readIndex();
  if (existing) {
    pointAt(existing.activeId);
    return existing;
  }
  const idx: PortfolioIndex = {
    portfolios: [{ id: LEGACY_PORTFOLIO_ID, name: DEFAULT_NAME, avatar: DEFAULT_AVATAR }],
    activeId: LEGACY_PORTFOLIO_ID,
  };
  writeIndex(idx);
  pointAt(idx.activeId);
  return idx;
}

/** Persist the index AND repoint holdings.ts at the (possibly new) active keys. */
function commit(idx: PortfolioIndex): PortfolioIndex {
  writeIndex(idx);
  pointAt(idx.activeId);
  return idx;
}

export function loadPortfolios(): PortfolioMeta[] {
  return ensurePortfolios().portfolios;
}

export function getActiveId(): string {
  return ensurePortfolios().activeId;
}

export function getActivePortfolio(): PortfolioMeta {
  const idx = ensurePortfolios();
  return idx.portfolios.find((p) => p.id === idx.activeId) ?? idx.portfolios[0];
}

export function setActivePortfolio(id: string): PortfolioIndex {
  const idx = ensurePortfolios();
  if (!idx.portfolios.some((p) => p.id === id)) return idx;
  return commit({ ...idx, activeId: id });
}

/** Creates a portfolio (with an empty holdings list) and makes it active. */
export function createPortfolio(name: string, avatar: string = DEFAULT_AVATAR): PortfolioIndex {
  const idx = ensurePortfolios();
  const clean = name.trim() || `Portfolio ${idx.portfolios.length + 1}`;
  const id = newId(idx.portfolios);
  saveHoldingsTo(holdingsKeyFor(id), []); // seed an empty list so the key exists
  return commit({
    portfolios: [...idx.portfolios, { id, name: clean, avatar }],
    activeId: id,
  });
}

/** Copies a portfolio's holdings into a new "… copy" portfolio and makes it active. */
export function duplicatePortfolio(id: string): PortfolioIndex {
  const idx = ensurePortfolios();
  const src = idx.portfolios.find((p) => p.id === id);
  if (!src) return idx;
  const newIdVal = newId(idx.portfolios);
  saveHoldingsTo(holdingsKeyFor(newIdVal), loadHoldingsFrom(holdingsKeyFor(id)));
  return commit({
    portfolios: [...idx.portfolios, { id: newIdVal, name: `${src.name} copy`, avatar: src.avatar ?? DEFAULT_AVATAR }],
    activeId: newIdVal,
  });
}

export function renamePortfolio(id: string, name: string): PortfolioIndex {
  const idx = ensurePortfolios();
  const clean = name.trim();
  if (!clean) return idx;
  // Rename doesn't change the active id, but commit() re-syncs the key harmlessly.
  return commit({
    ...idx,
    portfolios: idx.portfolios.map((p) => (p.id === id ? { ...p, name: clean } : p)),
  });
}

/** Updates a portfolio's name and/or avatar in one write (used by the Edit modal). */
export function updatePortfolio(id: string, patch: { name?: string; avatar?: string }): PortfolioIndex {
  const idx = ensurePortfolios();
  const name = patch.name?.trim();
  return commit({
    ...idx,
    portfolios: idx.portfolios.map((p) =>
      p.id === id
        ? { ...p, ...(name ? { name } : {}), ...(patch.avatar ? { avatar: patch.avatar } : {}) }
        : p,
    ),
  });
}

/**
 * Deletes a portfolio and its holdings key. The last portfolio can't be deleted — a wallet always
 * has at least one. If the active one is removed, the first remaining becomes active.
 */
export function deletePortfolio(id: string): PortfolioIndex {
  const idx = ensurePortfolios();
  if (idx.portfolios.length <= 1) return idx;
  if (!idx.portfolios.some((p) => p.id === id)) return idx;
  if (typeof window !== 'undefined') {
    try {
      // Never remove the legacy keys — deleting the "main" portfolio clears its lists instead, so a
      // downgrade doesn't find a missing key.
      if (id === LEGACY_PORTFOLIO_ID) {
        saveHoldingsTo(holdingsKeyFor(id), []);
        window.localStorage.setItem(snapshotsKeyFor(id), '[]');
      } else {
        window.localStorage.removeItem(holdingsKeyFor(id));
        window.localStorage.removeItem(snapshotsKeyFor(id));
      }
    } catch {
      /* ignore — index update below still removes it from the list */
    }
  }
  const portfolios = idx.portfolios.filter((p) => p.id !== id);
  const activeId = idx.activeId === id ? portfolios[0].id : idx.activeId;
  return commit({ portfolios, activeId });
}

// ── Active-portfolio holdings ── convenience wrappers so the view doesn't juggle keys.

export function loadActiveHoldings(): Holding[] {
  return loadHoldingsFrom(holdingsKeyFor(getActiveId()));
}
