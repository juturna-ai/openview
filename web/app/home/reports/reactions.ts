// Which reactions this browser has left on each report, kept in localStorage.
//
// Like the nickname, this is a label, not an identity: there are no accounts, so "my reaction" can
// only ever mean "this browser toggled it on". Persisting it is what makes the toggle round-trip a
// reload — without it a returning visitor's second click would add a duplicate instead of removing
// the first one.
//
// Same defensive try/catch as nickname.ts: storage access throws outright in some private browsing
// modes, and losing toggle memory is never worth taking the page down for.

const KEY = 'openview:reports-my-reactions';

/** Oldest entries are dropped past this, so the map can't grow forever as reports accumulate. */
const MAX_REPORTS = 50;

type Store = Record<string, string[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

export function getMyReactions(reportId: string): string[] {
  const v = read()[reportId];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function setMyReactions(reportId: string, emojis: string[]) {
  try {
    const store = read();
    delete store[reportId]; // re-insert so this report becomes the newest entry
    if (emojis.length > 0) store[reportId] = emojis;
    const ids = Object.keys(store);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_REPORTS))) delete store[id];
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Non-fatal: the toggle just won't survive a reload.
  }
}
