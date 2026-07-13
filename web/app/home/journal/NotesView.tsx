'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Icon } from './icons';
import {
  addNote,
  deleteNote,
  formatNoteDate,
  loadNotes,
  NOTE_COLORS,
  updateNote,
  type Note,
} from './notes';

// Notes board — a port of Reach's NotesView (src/components/Notes/NotesView.jsx). Same behavior:
// search, a Pinned section above the rest, click-a-card-to-edit, an 8-swatch color picker, and a
// modal form. Notes live in localStorage (see notes.ts).

export default function NotesView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');

  // Form state. `editing` is the note being edited, or null when composing a new one.
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);

  // Right-click menu: viewport coords + the note it was opened on.
  const [menu, setMenu] = useState<{ x: number; y: number; note: Note } | null>(null);
  // The note open in the read-only viewer, or null when closed.
  const [viewing, setViewing] = useState<Note | null>(null);

  useEffect(() => setNotes(loadNotes()), []);

  // Keep the board live if notes are written from another tab.
  useEffect(() => {
    const onStorage = () => setNotes(loadNotes());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Any click, scroll, or Escape anywhere dismisses the context menu — same as the calendar's.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Escape closes the viewer.
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setColor(null);
    setPinned(false);
    setEditing(null);
    setShowForm(false);
  };

  const handleSave = () => {
    // An entirely blank note is a no-op, as in Reach.
    if (!title.trim() && !content.trim()) return;
    setNotes(
      editing
        ? updateNote(editing.id, { title: title.trim(), content: content.trim(), color, pinned })
        : addNote({ title: title.trim(), content: content.trim(), color }),
    );
    resetForm();
  };

  const handleEdit = (note: Note) => {
    setTitle(note.title);
    setContent(note.content);
    setColor(note.color);
    setPinned(note.pinned);
    setEditing(note);
    setShowForm(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
    );
  }, [notes, search]);

  const pinnedNotes = filtered.filter((n) => n.pinned);
  const otherNotes = filtered.filter((n) => !n.pinned);

  const cardProps = {
    // A card click opens the read-only viewer, not the editor — clicking a note to read it must not
    // put you in a form where a stray keystroke edits it. Editing is a deliberate act: the viewer's
    // Edit button, or the right-click menu.
    onOpen: setViewing,
    onDelete: (id: number) => setNotes(deleteNote(id)),
    onTogglePin: (n: Note) => setNotes(updateNote(n.id, { pinned: !n.pinned })),
    onContextMenu: (e: React.MouseEvent, n: Note) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, note: n });
    },
  };

  // Same treatment as the cards and the viewer: the picked color previews as a top accent bar, not a
  // fill, so the form keeps its dark panel and the inputs need no contrast overrides.
  const formStyle = color ? ({ '--note-accent': color } as React.CSSProperties) : undefined;

  return (
    <div className="notes-container">
      <div className="notes-header">
        <h2>Notes</h2>
      </div>

      <div className="notes-toolbar">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search notes"
          />
        </div>
        <button
          className="btn-new-note"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          <Icon name="plus" size={16} /> New Note
        </button>
      </div>

      {showForm && (
        <div
          className="note-form-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div className={'note-form' + (color ? ' has-accent' : '')} style={formStyle}>
            <div className="note-form-header">
              <h3>{editing ? 'Edit Note' : 'New Note'}</h3>
              <button className="btn-icon" onClick={resetForm} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <input
              className="note-form-title"
              type="text"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className="note-form-content"
              placeholder="Write your note..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
            />
            <div className="note-form-footer">
              <div className="note-color-picker">
                {NOTE_COLORS.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className={'note-color-dot' + (color === c ? ' selected' : '')}
                    style={{
                      backgroundColor: c ?? 'var(--panel2)',
                      border: c ? 'none' : '2px solid var(--border)',
                    }}
                    onClick={() => setColor(c)}
                    aria-label={c ? `Color ${c}` : 'No color'}
                  />
                ))}
              </div>
              <div className="note-form-actions">
                {editing && (
                  <button
                    type="button"
                    className={'btn-pin' + (pinned ? ' active' : '')}
                    onClick={() => setPinned(!pinned)}
                  >
                    <Icon name={pinned ? 'pin-off' : 'pin'} size={14} />
                    {pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                <button className="btn-secondary" onClick={resetForm}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleSave}>
                  {editing ? 'Save' : 'Add Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pinnedNotes.length > 0 && (
        <div className="notes-section">
          <h3 className="notes-section-label">
            <Icon name="pin" size={12} /> Pinned
          </h3>
          <div className="notes-grid">
            {pinnedNotes.map((n) => (
              <NoteCard key={n.id} note={n} {...cardProps} />
            ))}
          </div>
        </div>
      )}

      <div className="notes-section">
        {pinnedNotes.length > 0 && otherNotes.length > 0 && (
          <h3 className="notes-section-label">Other</h3>
        )}
        {otherNotes.length > 0 ? (
          <div className="notes-grid">
            {otherNotes.map((n) => (
              <NoteCard key={n.id} note={n} {...cardProps} />
            ))}
          </div>
        ) : (
          pinnedNotes.length === 0 && (
            <div className="notes-empty">
              <Icon name="sticky-note" size={40} />
              {/* Distinguish "no notes at all" from "search matched nothing". */}
              <p>{search ? 'No matching notes' : 'No notes yet'}</p>
              <span>
                {search ? 'Try a different search.' : 'Click "New Note" to create your first note'}
              </span>
            </div>
          )
        )}
      </div>

      {/* Right-click menu. Clamped to the viewport so it never opens off-screen. */}
      {menu && (
        <div
          className="calendar-context-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 120),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setViewing(menu.note);
              setMenu(null);
            }}
          >
            View
          </button>
          <button
            type="button"
            onClick={() => {
              handleEdit(menu.note);
              setMenu(null);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              setNotes(deleteNote(menu.note.id));
              setMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {viewing && (
        <NoteViewer
          note={viewing}
          onClose={() => setViewing(null)}
          onEdit={(n) => {
            setViewing(null);
            handleEdit(n);
          }}
          onDelete={(n) => {
            setNotes(deleteNote(n.id));
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

/** Read-only note viewer — the full note, nothing editable. Edit is an explicit button, not a click. */
function NoteViewer({
  note,
  onClose,
  onEdit,
  onDelete,
}: {
  note: Note;
  onClose: () => void;
  onEdit: (n: Note) => void;
  onDelete: (n: Note) => void;
}) {
  // Delete is irreversible and sits one pixel from Edit, so it arms on the first click and only
  // deletes on the second. A misclick costs a click, not the note.
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The viewer is a floating panel, not a modal: no backdrop, so the board behind stays clickable
  // and scrollable while a note is open. Position is viewport coords of the top-left corner; null
  // until first measured, at which point it's centred (see the layout effect below).
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  /** Keep the panel fully on screen — used on first placement and on every drag frame. */
  const clamp = useCallback((x: number, y: number) => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - w)),
      y: Math.max(0, Math.min(y, window.innerHeight - h)),
    };
  }, []);

  // Centre on open. Layout effect so it paints centred rather than flashing at 0,0 first. Keyed on
  // note.id: opening a different note re-centres rather than inheriting the last one's position.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPos(
      clamp(
        (window.innerWidth - el.offsetWidth) / 2,
        (window.innerHeight - el.offsetHeight) / 2,
      ),
    );
  }, [note.id, clamp]);

  // Drag: listeners live on window, not the header, so yanking the pointer faster than React can
  // re-render doesn't drop the drag. Started by the header's onPointerDown.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [clamp]);

  // A resized window can strand the panel off-screen.
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const startDrag = (e: React.PointerEvent) => {
    // Only a plain left-press on the header chrome itself — never the close button, and never a
    // text selection inside the title.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault(); // Suppress the text-selection drag.
  };

  // Same treatment as the cards: the note's color is a top accent bar, not a fill. The panel keeps
  // its dark background, so the default text/muted/border tokens all stay legible and no light-vs-
  // dark contrast flipping is needed.
  const hasColor = !!note.color;

  return (
    // No overlay wrapper: the panel is positioned directly, so nothing covers the page behind it.
    // Hidden until measured, otherwise it paints once at 0,0 before the centring effect runs.
    <div
      ref={panelRef}
      className={'note-view note-view-floating' + (hasColor ? ' has-accent' : '')}
      style={
        {
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          ...(hasColor ? { '--note-accent': note.color } : {}),
        } as React.CSSProperties
      }
    >
      <div className="note-view-header note-view-drag" onPointerDown={startDrag}>
        <h3>{note.title || 'Untitled'}</h3>
        <div className="note-view-header-right">
          {note.pinned && (
            <span className="note-view-pin" title="Pinned">
              <Icon name="pin" size={14} />
            </span>
          )}
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>

      {/* Full content, untruncated — the card clips at 150 chars, this doesn't. */}
      {note.content ? (
        <div className="note-view-content">{note.content}</div>
      ) : (
        <div className="note-view-content note-view-empty">No content</div>
      )}

      <div className="note-view-footer">
        <div className="note-view-dates">
          <span>Created {formatNoteDate(note.created_at)}</span>
          <span>Updated {formatNoteDate(note.updated_at)}</span>
        </div>
        <div className="note-view-actions">
          {/* The only way into the editor from here — editing stays deliberate. */}
          <button className="btn-secondary btn-view-edit" onClick={() => onEdit(note)}>
            Edit
          </button>
          <button
            className={'btn-secondary btn-view-delete' + (confirmDelete ? ' armed' : '')}
            onClick={() => (confirmDelete ? onDelete(note) : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
            title={confirmDelete ? 'Click again to delete' : 'Delete note'}
          >
            {confirmDelete ? 'Sure?' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  note: Note;
  /** Opens the read-only viewer. Editing is reached from there, or the right-click menu. */
  onOpen: (n: Note) => void;
  onDelete: (id: number) => void;
  onTogglePin: (n: Note) => void;
  onContextMenu: (e: React.MouseEvent, n: Note) => void;
}

function NoteCard({ note, onOpen, onDelete, onTogglePin, onContextMenu }: CardProps) {
  const hasColor = !!note.color;

  // The color is a top accent bar, not a fill: the card keeps the normal dark panel background, so
  // the default text/muted/border tokens stay legible and none of the old light-vs-dark contrast
  // flipping is needed. The bar is a CSS var so one declaration drives it.
  return (
    <div
      className={'note-card' + (hasColor ? ' has-accent' : '')}
      style={hasColor ? ({ '--note-accent': note.color } as React.CSSProperties) : undefined}
      onClick={() => onOpen(note)}
      onContextMenu={(e) => onContextMenu(e, note)}
    >
      {note.pinned && (
        <span className="note-pin-indicator">
          <Icon name="pin" size={12} />
        </span>
      )}
      {note.title && <h4 className="note-card-title">{note.title}</h4>}
      {note.content && (
        <p className="note-card-content">
          {note.content.length > 150 ? note.content.slice(0, 150) + '...' : note.content}
        </p>
      )}
      <div className="note-card-footer">
        <span className="note-card-date">{formatNoteDate(note.updated_at)}</span>
        {/* Card click opens the viewer, so the action buttons must not bubble. */}
        <div className="note-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="note-action-btn"
            onClick={() => onTogglePin(note)}
            title={note.pinned ? 'Unpin' : 'Pin'}
          >
            <Icon name={note.pinned ? 'pin-off' : 'pin'} size={13} />
          </button>
          <button
            className="note-action-btn note-action-delete"
            onClick={() => onDelete(note.id)}
            title="Delete"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
