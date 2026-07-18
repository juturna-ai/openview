'use client';

import React, { useEffect, useState } from 'react';
import { Icon } from './icons';

// Edit-portfolio modal: pick an emoji avatar and rename the portfolio. Mirrors AddAssetModal's
// overlay/card chrome so it looks native to the wallet.

const MAX_NAME = 24;

// A small emoji set for the avatar picker — enough variety without a full emoji-keyboard dependency.
const AVATARS = [
  '👻', '🔥', '🚀', '💎', '🐳', '🦄', '🌙', '⚡',
  '🏦', '💰', '📈', '🪙', '🎯', '🧊', '🌈', '🦅',
  '🐂', '🐻', '🍀', '👑', '🛡️', '🎲', '🧠', '🌟',
];

interface Props {
  name: string;
  avatar: string;
  onSave: (data: { name: string; avatar: string }) => void;
  onClose: () => void;
}

export default function EditPortfolioModal({ name, avatar, onSave, onClose }: Props) {
  const [draftName, setDraftName] = useState(name);
  const [draftAvatar, setDraftAvatar] = useState(avatar);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    const clean = draftName.trim();
    if (!clean) return;
    onSave({ name: clean, avatar: draftAvatar });
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal wallet-modal wallet-edit-portfolio"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit portfolio"
      >
        <div className="modal-header">
          <h2>Edit portfolio</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="wep-body">
          <label className="wep-label">Portfolio avatar</label>
          <div className="wep-avatar-row">
            <span className="wep-avatar">{draftAvatar}</span>
            <button className="btn-primary" onClick={() => setPicking((v) => !v)}>
              Change
            </button>
          </div>

          {picking && (
            <div className="wep-avatar-grid" role="listbox" aria-label="Choose an avatar">
              {AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  className={'wep-avatar-choice' + (draftAvatar === emoji ? ' active' : '')}
                  onClick={() => {
                    setDraftAvatar(emoji);
                    setPicking(false);
                  }}
                  role="option"
                  aria-selected={draftAvatar === emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <label className="wep-label" htmlFor="wep-name">
            Portfolio Name
          </label>
          <input
            id="wep-name"
            className="wep-name-input"
            value={draftName}
            maxLength={MAX_NAME}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
          />
          <span className="wep-counter">
            {draftName.length}/{MAX_NAME} characters
          </span>

          <button className="btn-primary wep-save" onClick={save} disabled={!draftName.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
