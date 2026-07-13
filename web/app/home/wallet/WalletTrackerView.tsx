'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAINS,
  type Chain,
  defaultWallets,
  detectChain,
  fmtBal,
  fmtUsdVal,
  getChain,
  loadTracked,
  saveTracked,
  type TrackedWallet,
  truncAddr,
} from './chains';
import { Icon } from './icons';

// On-chain wallet tracker — ported from Reach's WalletTrackerView.jsx.
//
// Watch any address across 10 chains: native balance, USD value, live price, and a click-through
// token breakdown. All chain calls go through /api/wallet-tracker (public RPCs send no CORS headers,
// and external calls belong server-side regardless).
//
// Seeded on first visit with Reach's 20 known whale/exchange wallets, restorable via "Load Known
// Wallets". See loadTracked() for why a deliberately-emptied list stays empty.

interface Balance {
  balance: number;
  error?: string;
}
interface TokenRow {
  symbol: string;
  name: string;
  balance: number;
  usdValue: number;
  price: number;
  type: string;
  thumb: string;
  contractAddress: string;
}
interface PriceEntry {
  usd?: number;
  usd_24h_change?: number;
}

const REFRESH_MS = 60_000;

export default function WalletTrackerView() {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [addr, setAddr] = useState('');
  const [chain, setChain] = useState('ethereum');
  // Tracks whether the user has overridden the chain, so auto-detect stops fighting their choice.
  const [chainTouched, setChainTouched] = useState(false);
  const [addError, setAddError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [detail, setDetail] = useState<TrackedWallet | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensTotal, setTokensTotal] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setWallets(loadTracked());
  }, []);

  // Persist on every change, but not on the initial empty render — that would clobber stored
  // wallets with [] before the load effect above has run.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    saveTracked(wallets);
  }, [wallets]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Re-detect the chain as the address is typed, until the user picks one themselves.
  useEffect(() => {
    if (chainTouched) return;
    const guess = detectChain(addr);
    if (guess) setChain(guess);
  }, [addr, chainTouched]);

  const key = (w: TrackedWallet) => `${w.chain}:${w.address}`;

  const fetchAll = useCallback(async (list: TrackedWallet[]) => {
    if (list.length === 0) return;
    setLoading(true);
    try {
      const [priceRes, ...balRes] = await Promise.all([
        fetch('/api/wallet-tracker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'prices' }),
        })
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({})),
        ...list.map((w) =>
          fetch('/api/wallet-tracker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'balance', address: w.address, chain: w.chain }),
          })
            .then((r) => (r.ok ? r.json() : { balance: 0 }))
            .catch(() => ({ balance: 0 })),
        ),
      ]);

      setPrices(priceRes as Record<string, PriceEntry>);
      const next: Record<string, Balance> = {};
      list.forEach((w, i) => {
        next[`${w.chain}:${w.address}`] = balRes[i] as Balance;
      });
      setBalances(next);
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (wallets.length === 0) return;
    void fetchAll(wallets);
    const id = setInterval(() => void fetchAll(wallets), REFRESH_MS);
    return () => clearInterval(id);
  }, [wallets, fetchAll]);

  const usdOf = (w: TrackedWallet): number => {
    const cfg = getChain(w.chain);
    if (!cfg) return 0;
    const bal = balances[key(w)]?.balance ?? 0;
    return bal * (prices[cfg.cgId]?.usd ?? 0);
  };

  const totalUsd = wallets.reduce((s, w) => s + usdOf(w), 0);

  // Roll the per-wallet values up by chain for the summary pills.
  const chainTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const w of wallets) {
      totals.set(w.chain, (totals.get(w.chain) ?? 0) + usdOf(w));
    }
    return [...totals.entries()]
      .map(([id, usd]) => ({ chain: getChain(id), usd }))
      .filter((t): t is { chain: Chain; usd: number } => !!t.chain && t.usd > 0)
      .sort((a, b) => b.usd - a.usd);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usdOf closes over balances+prices
  }, [wallets, balances, prices]);

  const handleAdd = () => {
    const address = addr.trim();
    if (!address) return;
    const cfg = getChain(chain);
    if (!cfg) return;

    if (wallets.some((w) => w.address === address && w.chain === chain)) {
      setAddError('That address is already being tracked on this chain.');
      return;
    }

    const wallet: TrackedWallet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      address,
      chain,
    };
    setWallets((prev) => [...prev, wallet]);
    setAddr('');
    setChainTouched(false);
    setAddError('');
  };

  const handleRemove = (w: TrackedWallet) => {
    setWallets((prev) => prev.filter((x) => x.id !== w.id));
  };

  /** Restores the 20 seeded whales, keeping any addresses the user added themselves. */
  const handleLoadDefaults = () => {
    setWallets((prev) => {
      const defaults = defaultWallets();
      const seeded = new Set(defaults.map((d) => `${d.chain}:${d.address}`));
      const userAdded = prev.filter((w) => !seeded.has(`${w.chain}:${w.address}`));
      return [...defaults, ...userAdded];
    });
  };

  const handleCopy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — nothing useful to say */
    }
  };

  const openDetail = async (w: TrackedWallet) => {
    setDetail(w);
    setTokens([]);
    setTokensTotal(0);
    setTokenCount(0);
    setTokensLoading(true);
    try {
      const res = await fetch('/api/wallet-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tokens', address: w.address, chain: w.chain }),
      });
      const data = (await res.json()) as {
        tokens?: TokenRow[];
        totalUsd?: number;
        totalCount?: number;
      };
      setTokens(data.tokens ?? []);
      setTokensTotal(data.totalUsd ?? 0);
      setTokenCount(data.totalCount ?? data.tokens?.length ?? 0);
    } catch {
      setTokens([]);
    } finally {
      setTokensLoading(false);
    }
  };

  const selectedChain = getChain(chain);
  const detailChain = detail ? getChain(detail.chain) : null;

  return (
    <div className="wt-page">
      <div className="wt-header">
        <div className="wt-title-row">
          <h1 className="wt-title">Wallet Tracker</h1>
          <p className="wt-subtitle">
            Watch any on-chain address across 10 networks — balance, value and token holdings.
          </p>
        </div>
        <div className="wt-header-actions">
          <button
            className="wt-defaults-btn"
            onClick={handleLoadDefaults}
            title="Load 20 known whale wallets"
          >
            <Icon name="wallet" size={14} /> Load Known Wallets
          </button>
          <button
            className="gl-refresh-btn"
            onClick={() => void fetchAll(wallets)}
            disabled={loading || wallets.length === 0}
          >
            <Icon name="refresh-cw" size={14} className={loading ? 'spinning' : undefined} />
            {updatedAt && <span className="gl-updated">{updatedAt.toLocaleTimeString()}</span>}
          </button>
        </div>
      </div>

      {wallets.length > 0 && (
        <div className="wt-summary">
          <div className="wt-summary-main">
            <span className="wt-summary-label">Total Tracked Value</span>
            <span className="wt-summary-value">{fmtUsdVal(totalUsd)}</span>
          </div>
          <div className="wt-summary-chains">
            {chainTotals.map((t) => (
              <span key={t.chain.id} className="wt-chain-pill">
                <span className="wt-chain-dot" style={{ backgroundColor: t.chain.color }} />
                {t.chain.label}
                <span className="wt-chain-val">{fmtUsdVal(t.usd)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="wt-add-form">
        <div className="wt-chain-select" ref={menuRef}>
          <button className="wt-chain-trigger" onClick={() => setMenuOpen((o) => !o)}>
            <span className="wt-chain-dot" style={{ backgroundColor: selectedChain?.color }} />
            {selectedChain?.label}
            <Icon name="chevron-down" size={14} />
          </button>
          {menuOpen && (
            <div className="wt-chain-menu">
              {CHAINS.map((c) => (
                <button
                  key={c.id}
                  className={'wt-chain-option' + (c.id === chain ? ' active' : '')}
                  onClick={() => {
                    setChain(c.id);
                    setChainTouched(true);
                    setMenuOpen(false);
                  }}
                >
                  <span className="wt-chain-dot" style={{ backgroundColor: c.color }} />
                  {c.label}
                  <span className="wt-chain-sym">{c.symbol}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          className="wt-addr-input"
          type="text"
          placeholder="Enter wallet address (0x..., T..., base58, name.near)"
          value={addr}
          onChange={(e) => {
            setAddr(e.target.value);
            setAddError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <button className="wt-add-btn" onClick={handleAdd} disabled={!addr.trim()}>
          <Icon name="plus" size={15} /> Add
        </button>
      </div>

      {addError && <p className="wt-add-error">{addError}</p>}

      <div className="wt-wallet-list">
        {wallets.length === 0 ? (
          <div className="wt-empty">
            <span className="wt-empty-icon">
              <Icon name="wallet" size={40} />
            </span>
            <h2>No wallets tracked</h2>
            <p>
              Paste an address above — the network is detected automatically — or load the known
              whale wallets.
            </p>
            <button className="btn-primary" onClick={handleLoadDefaults}>
              <Icon name="wallet" size={15} /> Load Known Wallets
            </button>
          </div>
        ) : (
          wallets.map((w) => {
            const cfg = getChain(w.chain);
            if (!cfg) return null;
            const bal = balances[key(w)]?.balance ?? 0;
            const p = prices[cfg.cgId];
            const change = p?.usd_24h_change ?? 0;

            return (
              <div
                key={w.id}
                className="wt-wallet-card"
                onClick={() => void openDetail(w)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void openDetail(w);
                }}
              >
                <div className="wt-card-chain">
                  <span className="wt-chain-badge" style={{ backgroundColor: cfg.color }}>
                    {cfg.label.charAt(0)}
                  </span>
                  <span className="wt-card-chain-info">
                    {/* Seeded whales are named; user-added addresses fall back to the chain name. */}
                    <span className="wt-card-chain-name">{w.label || cfg.label}</span>
                    <span className="wt-card-addr">
                      {cfg.label} · {truncAddr(w.address)}
                    </span>
                  </span>
                </div>

                <div className="wt-card-balance">
                  <span className="wt-card-native">
                    {fmtBal(bal)} {cfg.symbol}
                  </span>
                  <span className="wt-card-usd">{fmtUsdVal(bal * (p?.usd ?? 0))}</span>
                </div>

                <div className="wt-card-price">
                  <span className="wt-card-price-val">{p?.usd ? fmtUsdVal(p.usd) : '—'}</span>
                  {p?.usd_24h_change != null && (
                    <span className={'wt-card-change ' + (change >= 0 ? 'up' : 'down')}>
                      <Icon name={change >= 0 ? 'trending-up' : 'trending-down'} size={12} />
                      {Math.abs(change).toFixed(2)}%
                    </span>
                  )}
                </div>

                {/* Buttons sit inside a clickable card — stop the click reaching the detail handler. */}
                <div className="wt-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="wt-action-btn"
                    onClick={() => void handleCopy(w.address)}
                    aria-label="Copy address"
                    title="Copy address"
                  >
                    <Icon name={copied === w.address ? 'check' : 'copy'} size={15} />
                  </button>
                  <a
                    className="wt-action-btn"
                    href={cfg.explorer + w.address}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in explorer"
                    title="Open in explorer"
                  >
                    <Icon name="external-link" size={15} />
                  </a>
                  <button
                    className="wt-action-btn wt-remove-btn"
                    onClick={() => handleRemove(w)}
                    aria-label="Remove wallet"
                    title="Remove"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="wt-footer">
        Native balances via public RPCs and Blockscout. Prices from CoinGecko. Auto-refreshes every
        60s.
      </p>

      {detail && detailChain && (
        <div className="wt-detail-overlay" onClick={() => setDetail(null)} role="presentation">
          <div
            className="wt-detail-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Wallet holdings"
          >
            <div className="wt-detail-header">
              <button
                className="wt-detail-back"
                onClick={() => setDetail(null)}
                aria-label="Back"
              >
                <Icon name="arrow-left" size={18} />
              </button>
              <span className="wt-chain-badge" style={{ backgroundColor: detailChain.color }}>
                {detailChain.label.charAt(0)}
              </span>
              <span className="wt-detail-info">
                <span className="wt-detail-name">{detail.label || detailChain.label}</span>
                <span className="wt-detail-addr">{truncAddr(detail.address)}</span>
              </span>
              <span className="wt-detail-header-actions">
                <a
                  className="wt-action-btn"
                  href={detailChain.explorer + detail.address}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open in explorer"
                >
                  <Icon name="external-link" size={15} />
                </a>
              </span>
            </div>

            <div className="wt-detail-total">
              <span className="wt-detail-total-label">Total Value</span>
              <span className="wt-detail-total-value">{fmtUsdVal(tokensTotal)}</span>
            </div>

            <div className="wt-detail-tokens">
              <div className="wt-detail-tokens-header">
                <Icon name="coins" size={15} /> Token Holdings
              </div>

              {tokensLoading ? (
                <p className="wt-detail-loading">Loading holdings…</p>
              ) : tokens.length === 0 ? (
                <p className="wt-detail-loading">No tokens found for this address.</p>
              ) : (
                <div className="wt-detail-token-list">
                  {tokens.map((t, i) => (
                    <div key={`${t.contractAddress}-${i}`} className="wt-token-row">
                      <span className="wt-token-info">
                        {t.thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element -- token logos come
                             from arbitrary per-token hosts; next/image can't allowlist them. */
                          <img className="wt-token-icon" src={t.thumb} alt="" loading="lazy" />
                        ) : (
                          <span className="wt-token-avatar">{t.symbol.charAt(0)}</span>
                        )}
                        <span className="wt-token-names">
                          <span className="wt-token-symbol">{t.symbol}</span>
                          <span className="wt-token-type">{t.type}</span>
                        </span>
                      </span>
                      <span className="wt-token-bal">
                        <span className="wt-token-amount">{fmtBal(t.balance)}</span>
                        {/* Solana/Tron have no price feed here (as in Reach) — show nothing rather
                            than a misleading $0.00. */}
                        {t.price > 0 && (
                          <span className="wt-token-usd">{fmtUsdVal(t.usdValue)}</span>
                        )}
                      </span>
                      <span className="wt-token-price">
                        {t.price > 0 ? fmtUsdVal(t.price) : '—'}
                      </span>
                    </div>
                  ))}
                  {tokenCount > tokens.length && (
                    <p className="wt-detail-loading">
                      Showing the {tokens.length} most valuable of {tokenCount.toLocaleString()}{' '}
                      tokens. The total above covers all of them.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
