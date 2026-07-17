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
  tokenExplorerUrl,
  trustWalletLogoUrl,
  type TrackedWallet,
} from './chains';
import ChainIcon from './ChainIcon';
import { genericTokenArt, getChainArt } from './chainIcons';
import {
  getTrackerBalances,
  getTrackerPrices,
  setTrackerBalances,
  setTrackerPrices,
} from './dataCache';
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

/**
 * Token row icon with a real-logo-first fallback cascade:
 *   1. the balance source's own logo (`thumb`), if any;
 *   2. else, for the native coin, the chain's SVG mark (`getChainArt`);
 *   3. else a best-effort real logo from Trust Wallet by contract (Blockscout chains only — see
 *      trustWalletLogoUrl);
 *   4. else a generic chain-tinted badge with the token's initial (`genericTokenArt`).
 * Steps 1 and 3 are remote images that can 404/hotlink-fail; `onError` walks to the next source, so a
 * broken logo never leaves an empty circle. The generic badge is a data-URI and always renders.
 */
function TokenIcon({
  chainId,
  symbol,
  thumb,
  contractAddress,
  isNative,
}: {
  chainId: string;
  symbol: string;
  thumb: string;
  contractAddress: string;
  isNative: boolean;
}) {
  const generic = genericTokenArt(chainId, symbol);
  // Ordered source list for this token; the first non-null is tried first, onError advances the index.
  const sources = useMemo(() => {
    const list: string[] = [];
    if (thumb) list.push(thumb);
    if (isNative) {
      const art = getChainArt(chainId);
      if (art) list.push(art);
    } else {
      const tw = trustWalletLogoUrl(chainId, contractAddress);
      if (tw) list.push(tw);
    }
    list.push(generic);
    return list;
  }, [thumb, isNative, chainId, contractAddress, generic]);

  const [idx, setIdx] = useState(0);
  // Reset when the token (hence the source list) changes — rows are recycled as the list re-renders.
  useEffect(() => setIdx(0), [sources]);

  const src = sources[Math.min(idx, sources.length - 1)];
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- token logos come from arbitrary per-token
       hosts (and inline data-URIs); next/image can't allowlist them. */
    <img
      className="wt-token-icon"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setIdx((i) => (i < sources.length - 1 ? i + 1 : i))}
    />
  );
}

export default function WalletTrackerView() {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  // Seed balances/prices from the session cache so a revisit (or a return from another folder tab)
  // paints the last-known numbers immediately instead of an empty list, while the fetch below
  // refreshes them. The cache never gates the fetch — it only removes the empty flash.
  const [balances, setBalances] = useState<Record<string, Balance>>(
    () => getTrackerBalances() ?? {},
  );
  const [prices, setPrices] = useState<Record<string, PriceEntry>>(() => getTrackerPrices() ?? {});
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Which chain's wallets the list is showing. Independent of `chain` below: that one picks the
  // network a *newly added* address belongs to (and auto-detects from what's typed), so tying the
  // two together would make typing a 0x address silently change what you're looking at.
  const [chainFilter, setChainFilter] = useState<string>(ALL_CHAINS);

  const [addr, setAddr] = useState('');
  const [newName, setNewName] = useState('');
  const [chain, setChain] = useState('ethereum');
  // Tracks whether the user has overridden the chain, so auto-detect stops fighting their choice.
  const [chainTouched, setChainTouched] = useState(false);
  const [addError, setAddError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const [detail, setDetail] = useState<TrackedWallet | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensTotal, setTokensTotal] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [tokensTooMany, setTokensTooMany] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Right-click row menu: which wallet, and where to anchor it (cursor position).
  const [ctxMenu, setCtxMenu] = useState<{ wallet: TrackedWallet; x: number; y: number } | null>(
    null,
  );
  // Rename dialog: the wallet being renamed plus its in-progress name value.
  const [editing, setEditing] = useState<TrackedWallet | null>(null);
  const [editName, setEditName] = useState('');

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

  // The row context menu closes on any outside click, scroll (it's anchored to a fixed cursor point,
  // so scrolling would strand it) or Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    // Close on outside click only — a click *inside* the menu must reach the item's onClick, so we
    // exclude it by ref rather than relying on stopPropagation (React synthetic stopPropagation does
    // not reliably stop this document-level native listener, which is why the items appeared dead).
    const close = (e: MouseEvent) => {
      if (ctxRef.current && ctxRef.current.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    const onScroll = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

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
      const priceMap = priceRes as Record<string, PriceEntry>;
      if (Object.keys(priceMap).length) {
        setPrices(priceMap);
        setTrackerPrices(priceMap);
      }

      // 173 seeded wallets. Firing them all at once (the original behaviour) buries the keyless
      // public RPCs behind /api/wallet-tracker and they start rejecting, so the requests go through
      // a worker pool instead. Results still fill in progressively (~143 of 173 within 15s) instead
      // of the whole list waiting on the slowest chain (Tron, serialised server-side at ~1.1s/call).
      //
      // But committing each of the ~173 results with its own setState re-rendered the entire list
      // (and recomputed the unmemoised total) up to 173 times per pass — O(N²) work. Instead each
      // landed balance is buffered in `pending` and flushed to state at most every FLUSH_MS, so a
      // pass is a handful of renders, not hundreds, while cards still visibly stream in.
      const pending: Record<string, Balance> = {};
      let dirty = false;
      const flush = () => {
        if (!dirty) return;
        dirty = false;
        const merged = { ...pending };
        setBalances((prev) => {
          const next = { ...prev, ...merged };
          setTrackerBalances(next);
          return next;
        });
      };
      const FLUSH_MS = 400;
      const flushTimer = setInterval(flush, FLUSH_MS);
      try {
        await poolMap(list, BALANCE_CONCURRENCY, async (w) => {
          const bal: Balance = await fetch('/api/wallet-tracker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'balance', address: w.address, chain: w.chain }),
          })
            .then((r) => (r.ok ? r.json() : { balance: 0 }))
            .catch(() => ({ balance: 0 }));
          pending[`${w.chain}:${w.address}`] = bal;
          dirty = true;
        });
      } finally {
        clearInterval(flushTimer);
        flush();
      }

      setUpdatedAt(new Date());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const usdOf = useCallback(
    (w: TrackedWallet): number => {
      const cfg = getChain(w.chain);
      if (!cfg) return 0;
      const bal = balances[`${w.chain}:${w.address}`]?.balance ?? 0;
      return bal * (prices[cfg.cgId]?.usd ?? 0);
    },
    [balances, prices],
  );

  // The total and the chain pills stay whole-portfolio: filtering the *view* shouldn't make the
  // headline value drop, which would read as "my money vanished" rather than "I'm looking at a
  // subset". Balances are likewise fetched for every wallet, not just the visible ones. Memoised so
  // it isn't recomputed over every wallet on unrelated re-renders (e.g. typing in the add form).
  const totalUsd = useMemo(
    () => wallets.reduce((s, w) => s + usdOf(w), 0),
    [wallets, usdOf],
  );

  // Only the rendered list is filtered.
  const visible = useMemo(() => filterByChain(wallets, chainFilter), [wallets, chainFilter]);
  const counts = useMemo(() => chainCounts(wallets), [wallets]);

  // Paginate the visible list — 20 rows per page. Balances/prices are still fetched for the whole
  // portfolio (see fetchOrder); only the render is capped.
  const PER_PAGE = 20;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  // Reset to the first page whenever the filter changes or the list shrinks below the current page.
  useEffect(() => {
    setPage(0);
  }, [chainFilter]);
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);
  const paged = useMemo(
    () => visible.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE),
    [visible, page],
  );
  // Windowed page numbers: always show first & last, the current page ± 1, with '…' gaps between.
  // Values are 0-based page indices; '…' marks a collapsed range.
  const pageItems = useMemo<(number | '…')[]>(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
    const set = new Set<number>([0, pageCount - 1, page, page - 1, page + 1]);
    const pages = [...set].filter((p) => p >= 0 && p < pageCount).sort((a, b) => a - b);
    const out: (number | '…')[] = [];
    for (let i = 0; i < pages.length; i++) {
      if (i > 0 && pages[i] - pages[i - 1] > 1) out.push('…');
      out.push(pages[i]);
    }
    return out;
  }, [page, pageCount]);

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
    if (chainFilter === ALL_CHAINS) {
      // The seed list is grouped by chain (ethereum … near), so a straight pass fetches NEAR — the
      // last group — only after ~90s, leaving every NEAR wallet at "0.00000000 NEAR / $0.00" for a
      // minute on load, which reads as broken. Round-robin across chains instead so each chain gets
      // its first balances early and no chain is starved at the tail. Same set, interleaved order.
      const byChain = new Map<string, TrackedWallet[]>();
      for (const w of wallets) {
        const g = byChain.get(w.chain);
        if (g) g.push(w);
        else byChain.set(w.chain, [w]);
      }
      const groups = [...byChain.values()];
      const interleaved: TrackedWallet[] = [];
      for (let i = 0; interleaved.length < wallets.length; i++) {
        for (const g of groups) if (i < g.length) interleaved.push(g[i]);
      }
      return interleaved;
    }
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
  }, [wallets, usdOf]);

  const handleAdd = () => {
    const address = addr.trim();
    if (!address) return;
    const cfg = getChain(chain);
    if (!cfg) return;

    if (wallets.some((w) => w.address === address && w.chain === chain)) {
      setAddError('That address is already being tracked on this chain.');
      return;
    }

    const name = newName.trim();
    const wallet: TrackedWallet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      address,
      chain,
      ...(name ? { label: name } : {}),
    };
    setWallets((prev) => [...prev, wallet]);
    setAddr('');
    setNewName('');
    setChainTouched(false);
    setAddError('');
  };

  const handleRemove = (w: TrackedWallet) => {
    setWallets((prev) => prev.filter((x) => x.id !== w.id));
  };

  const openEdit = (w: TrackedWallet) => {
    setEditing(w);
    setEditName(w.label ?? '');
  };

  const handleEditSave = () => {
    if (!editing) return;
    const name = editName.trim();
    setWallets((prev) =>
      prev.map((w) => (w.id === editing.id ? { ...w, label: name || undefined } : w)),
    );
    setEditing(null);
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

  // Monotonic id per openDetail call — a stale response (wallet A resolving after
  // the user already clicked wallet B) must not overwrite B's panel.
  const detailSeq = useRef(0);

  const openDetail = async (w: TrackedWallet) => {
    const seq = ++detailSeq.current;
    setDetail(w);
    setTokens([]);
    setTokensTotal(0);
    setTokenCount(0);
    setTokensTooMany(false);
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
        tooMany?: boolean;
      };
      if (seq !== detailSeq.current) return;
      setTokens(data.tokens ?? []);
      setTokensTotal(data.totalUsd ?? 0);
      setTokenCount(data.totalCount ?? data.tokens?.length ?? 0);
      setTokensTooMany(Boolean(data.tooMany));
    } catch {
      if (seq === detailSeq.current) setTokens([]);
    } finally {
      if (seq === detailSeq.current) setTokensLoading(false);
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
          className="wt-name-input"
          type="text"
          placeholder="Name (optional)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
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
          paged.map((w) => {
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ wallet: w, x: e.clientX, y: e.clientY });
                }}
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
                    <span
                      className="wt-card-addr"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCopy(w.address);
                      }}
                      title="Click to copy address"
                    >
                      {cfg.label} · {w.address}
                      {copied === w.address && <span className="wt-addr-copied"> ✓ copied</span>}
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

      {visible.length > PER_PAGE && (
        <div className="wt-pager" role="navigation" aria-label="Wallet list pages">
          <button
            className="wt-pager-btn wt-pager-arrow"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            <Icon name="chevron-left" size={16} />
          </button>
          {pageItems.map((it, i) =>
            it === '…' ? (
              <span key={`gap-${i}`} className="wt-pager-gap">
                …
              </span>
            ) : (
              <button
                key={it}
                className={'wt-pager-btn wt-pager-num' + (it === page ? ' active' : '')}
                onClick={() => setPage(it)}
                aria-label={`Page ${it + 1}`}
                aria-current={it === page ? 'page' : undefined}
              >
                {it + 1}
              </button>
            ),
          )}
          <button
            className="wt-pager-btn wt-pager-arrow"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            aria-label="Next page"
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      )}

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
                <span
                  className="wt-detail-addr"
                  onClick={() => void handleCopy(detail.address)}
                  title="Click to copy address"
                >
                  {detail.address}
                  {copied === detail.address && <span className="wt-addr-copied"> ✓ copied</span>}
                </span>
              </span>
              <span className="wt-detail-header-actions">
                <button
                  className="wt-action-btn"
                  onClick={() => void handleCopy(detail.address)}
                  aria-label="Copy address"
                  title="Copy address"
                >
                  <Icon name={copied === detail.address ? 'check' : 'copy'} size={15} />
                </button>
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
              ) : tokensTooMany ? (
                <p className="wt-detail-loading">
                  This wallet holds too many tokens to list. Native balance shown above.
                </p>
              ) : tokens.length === 0 ? (
                <p className="wt-detail-loading">No tokens found for this address.</p>
              ) : (
                <div className="wt-detail-token-list">
                  {tokens.map((t, i) => {
                    const isNative = t.type === 'native';
                    return (
                      <a
                        key={`${t.contractAddress}-${i}`}
                        className="wt-token-row"
                        href={
                          detailChain
                            ? tokenExplorerUrl(detailChain, {
                                native: isNative,
                                contractAddress: t.contractAddress,
                                walletAddress: detail.address,
                              })
                            : undefined
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="wt-token-info">
                          <TokenIcon
                            chainId={detailChain?.id ?? ''}
                            symbol={t.symbol}
                            thumb={t.thumb}
                            contractAddress={t.contractAddress}
                            isNative={isNative}
                          />
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
                      </a>
                    );
                  })}
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

      {/* Right-click row menu, anchored to the cursor. Fixed-position so it sits above the list;
          clicking any item runs its action and closes. */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="wt-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
        >
          <button
            className="wt-ctx-item"
            role="menuitem"
            onClick={() => {
              void openDetail(ctxMenu.wallet);
              setCtxMenu(null);
            }}
          >
            <Icon name="eye" size={15} /> View
          </button>
          <button
            className="wt-ctx-item"
            role="menuitem"
            onClick={() => {
              openEdit(ctxMenu.wallet);
              setCtxMenu(null);
            }}
          >
            <Icon name="edit" size={15} /> Rename
          </button>
          <button
            className="wt-ctx-item wt-ctx-danger"
            role="menuitem"
            onClick={() => {
              handleRemove(ctxMenu.wallet);
              setCtxMenu(null);
            }}
          >
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      )}

      {/* Rename dialog: change the wallet's display label only. Address and chain are immutable —
          remove and re-add to track a different address. */}
      {editing && (
        <div className="wt-detail-overlay" onClick={() => setEditing(null)} role="presentation">
          <div
            className="wt-edit-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Rename wallet"
          >
            <div className="wt-edit-header">
              <span className="wt-edit-title">Rename wallet</span>
              <button
                className="wt-action-btn"
                onClick={() => setEditing(null)}
                aria-label="Close"
                title="Close"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <label className="wt-edit-field">
              <span className="wt-edit-label">Name</span>
              <input
                className="wt-addr-input"
                type="text"
                placeholder="Wallet name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEditSave();
                }}
                autoFocus
              />
            </label>
            <div className="wt-edit-actions">
              <button className="wt-edit-cancel" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="wt-add-btn" onClick={handleEditSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
