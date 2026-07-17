'use client';

import React, { useEffect, useState } from 'react';
import { computePnl } from './trades';
import type { AssetClass, Trade, TradeDirection, TradeType } from './trades';

// Add-trade dialog, opened from the calendar's right-click context menu. The date is fixed to the
// cell that was clicked; everything else is entered here. P&L is derived from entry/exit/margin ×
// leverage unless the trade is left open, in which case it is forced to 0 (see the model notes in
// trades.ts).

const ASSET_CLASSES: AssetClass[] = ['stocks', 'futures', 'forex', 'crypto', 'options'];

interface Props {
  /** 'YYYY-MM-DD' — the calendar cell the user right-clicked. */
  dateKey: string;
  onSave: (trade: Omit<Trade, 'id'>) => void;
  onClose: () => void;
}

export default function TradeModal({ dateKey, onSave, onClose }: Props) {
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<TradeDirection>('long');
  const [assetClass, setAssetClass] = useState<AssetClass>('stocks');
  const [tradeType, setTradeType] = useState<TradeType>('spot');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [size, setSize] = useState('');
  const [commissions, setCommissions] = useState('');
  const [margin, setMargin] = useState('1');
  const [isOpen, setIsOpen] = useState(false);
  const [setupTag, setSetupTag] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const leverage = num(margin) || 1;
  const preview = isOpen
    ? 0
    : computePnl(num(entry), num(exit), num(size), direction, num(commissions), leverage);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) return;
    const entryPrice = num(entry);
    const marginUsd = num(size);
    onSave({
      trade_date: dateKey,
      symbol: symbol.trim().toUpperCase(),
      direction,
      asset_class: assetClass,
      entry_price: entryPrice,
      exit_price: isOpen ? 0 : num(exit),
      position_size: marginUsd,
      pnl: preview,
      commissions: num(commissions),
      margin: leverage,
      trade_type: tradeType,
      // Quantity of the underlying = notional (margin × leverage) / entry, spot only.
      amount_asset:
        tradeType === 'spot' && entryPrice ? (marginUsd * leverage) / entryPrice : null,
      is_open: isOpen,
      setup_tag: setupTag.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="trade-modal-backdrop" onMouseDown={onClose}>
      <div
        className="trade-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add trade"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="trade-modal-header">
          <h2>Add Trade</h2>
          <span className="trade-modal-date">{dateKey}</span>
          <button type="button" className="trade-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className="trade-modal-body" onSubmit={submit}>
          <label className="trade-field trade-field-wide">
            <span>Symbol</span>
            <input
              autoFocus
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="AAPL"
              required
            />
          </label>

          <label className="trade-field">
            <span>Direction</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as TradeDirection)}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>

          <label className="trade-field">
            <span>Asset Class</span>
            <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
              {ASSET_CLASSES.map((a) => (
                <option key={a} value={a}>
                  {a[0].toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <label className="trade-field">
            <span>Type</span>
            <select value={tradeType} onChange={(e) => setTradeType(e.target.value as TradeType)}>
              <option value="spot">Spot</option>
              <option value="futures">Futures</option>
            </select>
          </label>

          <label className="trade-field">
            <span>Entry Price</span>
            <input
              type="number"
              step="any"
              min="0"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label className="trade-field">
            <span>Exit Price</span>
            <input
              type="number"
              step="any"
              min="0"
              value={exit}
              onChange={(e) => setExit(e.target.value)}
              placeholder="0.00"
              disabled={isOpen}
            />
          </label>

          <label className="trade-field">
            <span>Margin (USD)</span>
            <input
              type="number"
              step="any"
              min="0"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="0"
            />
          </label>

          <label className="trade-field">
            <span>Commissions</span>
            <input
              type="number"
              step="any"
              min="0"
              value={commissions}
              onChange={(e) => setCommissions(e.target.value)}
              placeholder="0"
            />
          </label>

          <label className="trade-field">
            <span>Leverage</span>
            <input
              type="number"
              step="any"
              min="1"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
            />
          </label>

          <label className="trade-field">
            <span>Setup Tag</span>
            <input
              value={setupTag}
              onChange={(e) => setSetupTag(e.target.value)}
              placeholder="Breakout"
            />
          </label>

          <label className="trade-field trade-field-wide">
            <span>Notes</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why you took it, how it went…"
            />
          </label>

          <label className="trade-checkbox trade-field-wide">
            <input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} />
            <span>Still open (no P&amp;L yet)</span>
          </label>

          <div className="trade-modal-footer">
            <div className="trade-pnl-preview">
              <span>Net P&amp;L</span>
              <strong className={preview >= 0 ? 'profit' : 'loss'}>
                {preview >= 0 ? '+' : '-'}${Math.abs(preview).toFixed(2)}
              </strong>
            </div>
            <div className="trade-modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Add Trade
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
