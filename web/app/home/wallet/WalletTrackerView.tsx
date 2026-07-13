'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_CHAINS,
  CHAINS,
  type Chain,
  chainCounts,
  DEFAULT_WALLETS,
  defaultWallets,
  detectChain,
  filterByChain,
  fmtBal,
  fmtUsdVal,
  getChain,
  loadTracked,
  poolMap,
  saveTracked,
  type TrackedWallet,
  truncAddr,
} from './chains';
import ChainIcon from './ChainIcon';
import { Icon } from './icons';

// On-chain wallet tracker — ported from Reach's WalletTrackerView.jsx.
//
// Watch any address across 10 chains: native balance, USD value, live price, and a click-through
// token breakdown. All chain calls go through /api/wallet-tracker (public RPCs send no CORS headers,
// and external calls belong server-side regardless).
//
// Seeded on first visit with the known whale/exchange wallets in DEFAULT_WALLETS — the ~20 biggest
// verified public addresses on each chain — restorable via "Load Known Wallets". See loadTracked()
// for why a deliberately-emptied list stays empty.

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

/**
 * A full pass over the 173 seeded wallets takes ~100s, not because of the pool below but because the
 * route serialises Tron at ~1.1s/call (TRON_MIN_GAP_MS) — 19 Tron wallets alone are a ~21s floor, and
 * they land last. Measured: ~143/173 priced by 15s, the tail trickling in to ~100s.
 *
 * So the refresh interval has to clear the worst-case pass. At Reach's 60s the next refresh would
 * start while the previous one was still draining, stacking overlapping request waves onto the same
 * rate-limited endpoints — the pile-up gets worse, not better, the longer the tab is open.
 */
const REFRESH_MS = 150_000;

/**
 * Balance lookups in flight at once. The route fans each one out to a keyless public RPC, and the
 * seeded list is 173 wallets — unbounded parallelism (the original code's Promise.all over the whole
 * list) trips rate limits on publicnode and Solana's public RPC. Six is a measured compromise: it
 * gets the great majority of cards priced within ~15s without tripping the limits.
 */
const BALANCE_CONCURRENCY = 6;

export default function WalletTrackerView() {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Which chain's wallets the list is showing. Independent of `chain` below: that one picks the
  // network a *newly added* address belongs to (and auto-detects from what's typed), so tying the
  // two together would make typing a 0x address silently change what you're looking at.
  const [chainFilter, setChainFilter] = useState<string>(ALL_CHAINS);

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

  // A pass can outlive its interval (Tron's serialisation alone is a ~21s floor), and a second pass
  // starting on top of the first would stack request waves onto the same rate-limited endpoints —
  // making the pile-up worse the longer the tab stays open. One pass at a time; a tick that arrives
  // while one is running is dropped, not queued, since the next tick will refetch anyway.
  const inFlight = useRef(false);

  const fetchAll = useCallback(async (list: TrackedWallet[]) => {
    if (list.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const priceRes = await fetch('/api/wallet-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prices' }),
      })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
      setPrices(priceRes as Record<string, PriceEntry>);

      // 173 seeded wallets. Firing them all at once (the original behaviour) buries the keyless
      // public RPCs behind /api/wallet-tracker and they start rejecting, so the requests go through
      // a worker pool instead. Results are merged in as each lands rather than in one batch at the
      // end — cards fill in progressively (~143 of 173 within 15s) instead of the whole list sitting
      // empty until the slowest chain (Tron, serialised server-side at ~1.1s/call) finishes.
      await poolMap(list, BALANCE_CONCURRENCY, async (w) => {
        const bal: Balance = await fetch('/api/wallet-tracker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'balance', address: w.address, chain: w.chain }),
        })
          .then((r) => (r.ok ? r.json() : { balance: 0 }))
          .catch(() => ({ balance: 0 }));
        setBalances((prev) => ({ ...prev, [`${w.chain}:${w.address}`]: bal }));
      });

      setUpdatedAt(new Date());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const usdOf = (w: TrackedWallet): number => {
    const cfg = getChain(w.chain);
    if (!cfg) return 0;
    const bal = balances[key(w)]?.balance ?? 0;
    return bal * (prices[cfg.cgId]?.usd ?? 0);
  };

  // The total and the chain pills stay whole-portfolio: filtering the *view* shouldn't make the
  // headline value drop, which would read as "my money vanished" rather than "I'm looking at a
  // subset". Balances are likewise fetched for every wallet, not just the visible ones.
  const totalUsd = wallets.reduce((s, w) => s + usdOf(w), 0);

  // Only the rendered list is filtered.
  const visible = useMemo(() => filterByChain(wallets, chainFilter), [wallets, chainFilter]);
  const counts = useMemo(() => chainCounts(wallets), [wallets]);

  // A filter pill per chain that actually has wallets — an "Avalanche (0)" pill leading to an empty
  // list is a dead end. If the selected chain's last wallet is removed, fall back to All so the user
  // is never stranded staring at an empty tracker.
  const filterChains = useMemo(
    () => CHAINS.filter((c) => (counts.get(c.id) ?? 0) > 0),
    [counts],
  );
  useEffect(() => {
    if (chainFilter !== ALL_CHAINS && (counts.get(chainFilter) ?? 0) === 0) {
      setChainFilter(ALL_CHAINS);
    }
  }, [counts, chainFilter]);

  // Fetch order: what's on screen first, the rest after. A full pass is ~100s (Tron is serialised
  // server-side), so a chain sitting late in the list — Solana, Tron, NEAR — would otherwise show a
  // screen of "0.00000000 SOL / $0.00" for a minute after being selected, which reads as broken data
  // rather than as pending. Every wallet is still fetched, so the headline total stays whole; only
  // the order changes.
  //
  // Caveat: fetchAll's in-flight guard drops this if a pass is already running, so switching filters
  // mid-pass doesn't jump the queue — those balances just arrive when the running pass reaches them.
  // Deliberate: cancelling and restarting the pass on every filter click would re-request everything
  // already fetched and hammer the same rate-limited endpoints, which is the failure this guard
  // exists to prevent. Prioritisation is a nice-to-have; not melting the RPCs is not.
  const fetchOrder = useMemo(() => {
    if (chainFilter === ALL_CHAINS) return wallets;
    const onScreen = new Set(visible.map((w) => w.id));
    return [...visible, ...wallets.filter((w) => !onScreen.has(w.id))];
  }, [wallets, visible, chainFilter]);

  useEffect(() => {
    if (fetchOrder.length === 0) return;
    void fetchAll(fetchOrder);
    const id = setInterval(() => void fetchAll(fetchOrder), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchOrder, fetchAll]);

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

  /** Restores the seeded whales, keeping any addresses the user added themselves. */
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
            Watch any on-chain address across {CHAINS.length} networks — balance, value and token
            holdings. Seeded with the {DEFAULT_WALLETS.length} biggest known wallets on every chain.
          </p>
        </div>
        <div className="wt-header-actions">
          <button
            className="wt-defaults-btn"
            onClick={handleLoadDefaults}
            title={`Load ${DEFAULT_WALLETS.length} known whale wallets`}
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
                <ChainIcon chain={t.chain} size={16} />
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
            {selectedChain && <ChainIcon chain={selectedChain} size={18} />}
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
                  <ChainIcon chain={c} size={18} />
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

      {/* Chain filter. Distinct from the add-form's chain picker above: this narrows what's listed,
          that one says which network a new address is on. */}
      {wallets.length > 0 && (
        <div className="wt-filter-row" role="group" aria-label="Filter wallets by chain">
          <button
            className={'wt-filter-pill' + (chainFilter === ALL_CHAINS ? ' active' : '')}
            onClick={() => setChainFilter(ALL_CHAINS)}
            aria-pressed={chainFilter === ALL_CHAINS}
          >
            All Chains
            <span className="wt-filter-count">{wallets.length}</span>
          </button>
          {filterChains.map((c) => (
            <button
              key={c.id}
              className={'wt-filter-pill' + (chainFilter === c.id ? ' active' : '')}
              onClick={() => setChainFilter(c.id)}
              aria-pressed={chainFilter === c.id}
            >
              <ChainIcon chain={c} size={16} />
              {c.label}
              <span className="wt-filter-count">{counts.get(c.id)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Column headers. Mirrors .wt-wallet-card's grid exactly, so the labels sit over the columns
          they describe. Hidden when the list is empty — there'd be nothing under them. */}
      {visible.length > 0 && (
        <div className="wt-list-head" aria-hidden="true">
          <span>Wallet</span>
          <span className="wt-list-head-num">Balance</span>
          <span className="wt-list-head-num">Price / 24h</span>
          <span className="wt-list-head-actions">Actions</span>
        </div>
      )}

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
          visible.map((w) => {
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
                  <ChainIcon chain={cfg} size={32} />
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
              <ChainIcon chain={detailChain} size={32} />
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
