// Notes data model + localStorage persistence.
//
// Mirrors Reach's SQLite `notes` table (snake_case columns) so notes stay portable between the two
// apps. Stored under `ov_notes`, the same pattern as `ov_trades` — there is no auth or server DB
// in this app, so notes are per-browser.

export interface Note {
  id: number;
  title: string;
  content: string;
  /** One of NOTE_COLORS, or null for the default card background. */
  color: string | null;
  pinned: boolean;
  /** ISO timestamps. */
  created_at: string;
  updated_at: string;
}

/** `null` = no color (default card bg); the rest match Reach's palette exactly. */
export const NOTE_COLORS: (string | null)[] = [
  null,
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
];

export const NOTES_KEY = 'ov_notes';

/** Perceived luminance — light backgrounds need dark text. Same threshold as Reach. */
export function isLightColor(hex: string | null): boolean {
  if (!hex) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

export function formatNoteDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Narrows unknown localStorage JSON to a Note; returns null for anything unusable. */
function coerce(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'number' || !Number.isFinite(n.id)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: n.id,
    title: str(n.title),
    content: str(n.content),
    color: typeof n.color === 'string' ? n.color : null,
    pinned: Boolean(n.pinned),
    created_at: str(n.created_at),
    updated_at: str(n.updated_at),
  };
}

/**
 * Reads all notes, pinned first then most-recently-updated — the same ordering as Reach's
 * `ORDER BY pinned DESC, updated_at DESC`. Returns [] on the server or if storage is unreadable.
 */
export function loadNotes(): Note[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(NOTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(coerce)
      .filter((n): n is Note => n !== null)
      .sort((a, b) =>
        a.pinned !== b.pinned ? Number(b.pinned) - Number(a.pinned) : b.updated_at.localeCompare(a.updated_at),
      );
  } catch {
    return [];
  }
}

/** Writes the full list back. Silently no-ops if storage is blocked or full. */
export function saveNotes(notes: Note[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    /* quota exceeded or storage blocked — keep the in-memory list rather than throwing */
  }
}

/**
 * Each mutation re-reads storage first, so a write from another tab isn't clobbered by a stale
 * in-memory copy, and returns the new sorted list.
 */
export function addNote(fields: Pick<Note, 'title' | 'content' | 'color'>): Note[] {
  const existing = loadNotes();
  const now = new Date().toISOString();
  const id = existing.reduce((max, n) => Math.max(max, n.id), 0) + 1;
  saveNotes([...existing, { ...fields, id, pinned: false, created_at: now, updated_at: now }]);
  return loadNotes();
}

export function updateNote(
  id: number,
  fields: Partial<Pick<Note, 'title' | 'content' | 'color' | 'pinned'>>,
): Note[] {
  const next = loadNotes().map((n) =>
    n.id === id ? { ...n, ...fields, updated_at: new Date().toISOString() } : n,
  );
  saveNotes(next);
  return loadNotes();
}

export function deleteNote(id: number): Note[] {
  const next = loadNotes().filter((n) => n.id !== id);
  saveNotes(next);
  return loadNotes();
}
