'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import {
  addNote,
  deleteNote,
  formatNoteDate,
  isLightColor,
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
    onEdit: handleEdit,
    onDelete: (id: number) => setNotes(deleteNote(id)),
    onTogglePin: (n: Note) => setNotes(updateNote(n.id, { pinned: !n.pinned })),
    onContextMenu: (e: React.MouseEvent, n: Note) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, note: n });
    },
  };

  // Inside a colored form the text/borders must flip to stay legible.
  const onLight = isLightColor(color);
  const formStyle = color
    ? { backgroundColor: color, color: onLight ? '#1a1a2e' : '#fff' }
    : undefined;
  const fieldStyle = color
    ? { color: 'inherit', borderColor: onLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)' }
    : undefined;

  return (
    <div className="notes-container">
      <div className="notes-header">
        <h2>Notes</h2>
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
      </div>

      {showForm && (
        <div
          className="note-form-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetForm();
          }}
        >
          <div className="note-form" style={formStyle}>
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
              style={fieldStyle}
            />
            <textarea
              className="note-form-content"
              placeholder="Write your note..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              style={fieldStyle}
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

      {viewing && <NoteViewer note={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Read-only note viewer — the full note, nothing editable. */
function NoteViewer({ note, onClose }: { note: Note; onClose: () => void }) {
  const onLight = isLightColor(note.color);
  const style = note.color
    ? { backgroundColor: note.color, color: onLight ? '#1a1a2e' : '#fff' }
    : undefined;
  // On a colored card the default muted/border tokens vanish, so derive them from the background.
  const muted = note.color ? (onLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)') : undefined;
  const rule = note.color
    ? onLight
      ? 'rgba(0,0,0,0.12)'
      : 'rgba(255,255,255,0.18)'
    : undefined;

  return (
    <div
      className="note-form-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="note-view" style={style}>
        <div className="note-view-header" style={rule ? { borderBottomColor: rule } : undefined}>
          <h3>{note.title || 'Untitled'}</h3>
          <div className="note-view-header-right">
            {note.pinned && (
              <span className="note-view-pin" style={{ color: muted }} title="Pinned">
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
          <div className="note-view-content note-view-empty" style={{ color: muted }}>
            No content
          </div>
        )}

        <div className="note-view-footer" style={rule ? { borderTopColor: rule, color: muted } : { color: muted }}>
          <span>Created {formatNoteDate(note.created_at)}</span>
          <span>Updated {formatNoteDate(note.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  note: Note;
  onEdit: (n: Note) => void;
  onDelete: (id: number) => void;
  onTogglePin: (n: Note) => void;
  onContextMenu: (e: React.MouseEvent, n: Note) => void;
}

function NoteCard({ note, onEdit, onDelete, onTogglePin, onContextMenu }: CardProps) {
  const hasColor = !!note.color;
  const lightBg = hasColor && isLightColor(note.color);
  const muted = hasColor ? (lightBg ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)') : undefined;

  return (
    <div
      className={'note-card' + (hasColor ? ' has-color' : '') + (lightBg ? ' light-bg' : '')}
      style={hasColor ? { backgroundColor: note.color!, color: lightBg ? '#1a1a2e' : '#fff' } : undefined}
      onClick={() => onEdit(note)}
      onContextMenu={(e) => onContextMenu(e, note)}
    >
      {note.pinned && (
        <span className="note-pin-indicator" style={{ color: muted }}>
          <Icon name="pin" size={12} />
        </span>
      )}
      {note.title && <h4 className="note-card-title">{note.title}</h4>}
      {note.content && (
        <p className="note-card-content" style={{ color: muted }}>
          {note.content.length > 150 ? note.content.slice(0, 150) + '...' : note.content}
        </p>
      )}
      <div className="note-card-footer" style={{ color: muted }}>
        <span className="note-card-date">{formatNoteDate(note.updated_at)}</span>
        {/* Card click opens the editor, so the action buttons must not bubble. */}
        <div className="note-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="note-action-btn"
            onClick={() => onTogglePin(note)}
            title={note.pinned ? 'Unpin' : 'Pin'}
            style={hasColor ? { color: muted } : undefined}
          >
            <Icon name={note.pinned ? 'pin-off' : 'pin'} size={13} />
          </button>
          <button
            className="note-action-btn note-action-delete"
            onClick={() => onDelete(note.id)}
            title="Delete"
            style={hasColor ? { color: lightBg ? '#a03030' : '#ffaaaa' } : undefined}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
