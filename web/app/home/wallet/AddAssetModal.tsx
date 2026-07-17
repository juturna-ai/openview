'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import AssetIcon from './AssetIcon';
import { ASSET_CATALOG, type AssetType, type CatalogAsset, TYPE_TABS } from './assets';
import type { Holding } from './holdings';
import { Icon } from './icons';

// Add / Edit holding modal — ported from Reach's AddHoldingForm.jsx.
//
// In edit mode the asset itself is fixed (Reach does the same): only the amount and average buy
// price are editable, so the picker collapses to a read-only header.

interface Props {
  /** Present when editing an existing holding; absent when adding a new one. */
  holding?: Holding | null;
  onSave: (data: {
    assetType: AssetType;
    symbol: string;
    name: string;
    amount: number;
    avgBuyPrice: number;
    purchasedAt: number;
    feePct: number;
    notes: string;
  }) => void;
  onClose: () => void;
}

/** Default trading fee applied to a new purchase, as a percent of trade value. */
const DEFAULT_FEE_PCT = '0.5';

/**
 * Formats an epoch-ms instant for `<input type="datetime-local">`, which wants a bare local
 * "YYYY-MM-DDTHH:mm" with no zone suffix — toISOString() would shift the clock to UTC.
 */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export default function AddAssetModal({ holding, onSave, onClose }: Props) {
  const isEditing = !!holding;

  const [assetType, setAssetType] = useState<AssetType>(holding?.asset_type ?? 'crypto');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CatalogAsset | null>(
    holding ? { symbol: holding.symbol, name: holding.name } : null,
  );
  const [amount, setAmount] = useState(holding ? String(holding.amount) : '');
  const [avgBuyPrice, setAvgBuyPrice] = useState(holding ? String(holding.avg_buy_price) : '0');
  // Defaults to now for a new purchase; an older holding keeps whatever it was saved with. Computed
  // once on mount so the field doesn't tick forward while the form is open.
  const [purchasedAt, setPurchasedAt] = useState(() =>
    toLocalInputValue(holding?.purchased_at ?? Date.now()),
  );
  const [feePct, setFeePct] = useState(
    holding?.fee_pct !== undefined ? String(holding.fee_pct) : DEFAULT_FEE_PCT,
  );
  const [notes, setNotes] = useState(holding?.notes ?? '');

  const amountRef = useRef<HTMLInputElement>(null);

  // The dollar fee is derived, never stored — it would go stale the moment amount or price changed.
  const feeAmount = useMemo(() => {
    const value = (parseFloat(amount) || 0) * (parseFloat(avgBuyPrice) || 0);
    const pct = parseFloat(feePct) || 0;
    return (value * pct) / 100;
  }, [amount, avgBuyPrice, feePct]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Jump straight to the amount field once an asset is picked — it's the only thing left to do.
  useEffect(() => {
    if (selected && !isEditing) amountRef.current?.focus();
  }, [selected, isEditing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ASSET_CATALOG[assetType] ?? [];
    if (!q) return list;
    return list.filter(
      (a) => a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q),
    );
  }, [assetType, search]);

  const handleTab = (id: AssetType) => {
    setAssetType(id);
    setSelected(null);
    setSearch('');
  };

  const canSubmit = (isEditing || !!selected) && parseFloat(amount) > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const asset = isEditing
      ? { symbol: holding!.symbol, name: holding!.name }
      : selected!;
    // An emptied/half-typed datetime parses to NaN — fall back to now rather than saving a bad date.
    const parsedDate = new Date(purchasedAt).getTime();
    onSave({
      assetType: isEditing ? holding!.asset_type : assetType,
      symbol: asset.symbol,
      name: asset.name,
      amount: parseFloat(amount),
      avgBuyPrice: parseFloat(avgBuyPrice) || 0,
      purchasedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
      feePct: parseFloat(feePct) || 0,
      notes: notes.trim(),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal wallet-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit holding' : 'Add asset'}
      >
        <div className="modal-header">
          <h2>{isEditing ? 'Edit Holding' : 'Add Asset'}</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="modal-body">
          {!isEditing && (
            <>
              <div className="wallet-type-tabs">
                {TYPE_TABS.map((t) => (
                  <button
                    key={t.id}
                    className={'wallet-type-tab' + (assetType === t.id ? ' active' : '')}
                    onClick={() => handleTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="wallet-search">
                <Icon name="search" size={16} />
                <input
                  type="text"
                  placeholder="Search assets..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="wallet-asset-grid">
                {filtered.map((a) => (
                  <button
                    key={a.symbol}
                    className={
                      'wallet-asset-btn' + (selected?.symbol === a.symbol ? ' selected' : '')
                    }
                    onClick={() => setSelected(a)}
                  >
                    <AssetIcon symbol={a.symbol} assetType={assetType} size={28} />
                    <span className="wallet-asset-label">
                      <span className="wallet-asset-name">{a.name}</span>
                      <span className="wallet-asset-sym">{a.symbol}</span>
                    </span>
                  </button>
                ))}
                {filtered.length === 0 && <p className="wallet-hint">No assets match that search.</p>}
              </div>
            </>
          )}

          {(isEditing || selected) && (
            <div className="wallet-selected-info">
              <AssetIcon
                symbol={(isEditing ? holding!.symbol : selected!.symbol)}
                assetType={isEditing ? holding!.asset_type : assetType}
                size={28}
              />
              <span>
                {isEditing ? holding!.name : selected!.name} (
                {isEditing ? holding!.symbol : selected!.symbol})
              </span>
            </div>
          )}

          {(isEditing || selected) && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="holdingAmount">Amount</label>
                <input
                  id="holdingAmount"
                  ref={amountRef}
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="holdingAvgPrice">Avg. Buy Price</label>
                <div className="input-with-prefix">
                  <span className="input-prefix">$</span>
                  <input
                    id="holdingAvgPrice"
                    type="number"
                    step="any"
                    min="0"
                    value={avgBuyPrice}
                    onChange={(e) => setAvgBuyPrice(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {(isEditing || selected) && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="holdingPurchasedAt">Date Purchased</label>
                <input
                  id="holdingPurchasedAt"
                  type="datetime-local"
                  value={purchasedAt}
                  onChange={(e) => setPurchasedAt(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="holdingFeePct">Fee</label>
                <div className="input-with-suffix">
                  <input
                    id="holdingFeePct"
                    type="number"
                    step="any"
                    min="0"
                    value={feePct}
                    onChange={(e) => setFeePct(e.target.value)}
                  />
                  <span className="input-suffix">%</span>
                </div>
                <span className="form-hint">
                  ≈ ${feeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {(isEditing || selected) && (
            <div className="form-group wallet-notes-group">
              <label htmlFor="holdingNotes">Notes</label>
              <textarea
                id="holdingNotes"
                rows={2}
                placeholder="Optional — exchange, strategy, anything worth remembering."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          )}

          {!isEditing && !selected && (
            <p className="wallet-hint">Select an asset above, then enter your holdings.</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {isEditing ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
