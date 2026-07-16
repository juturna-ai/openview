'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Chain, fmtBal, fmtUsdVal, getChain, truncAddr } from './chains';
import ChainIcon from './ChainIcon';
import { genericTokenArt, getChainArt } from './chainIcons';
import { trustWalletLogoUrl } from './chains';
import { getExplorerResult, setExplorerResult } from './dataCache';
import { classify, EVM_CHAIN_IDS, EXPLORER_FAMILIES, resolveChain, txUrlClient } from './explorerDetect';
import { Icon } from './icons';

// Multi-chain transaction Explorer — the Wallet dashboard's search surface. Paste an address or a tx
// hash and see recent transactions / a single tx's detail across EVM, Solana, Sui, Cardano and NEAR.
//
// Blockscan-style: a clean centered hero with one wide search bar and a row of chain-family pills
// below it (the button row: All / EVM / Solana / SUI / Cardano / NEAR / Tron). Once a result is
// showing the hero collapses to a compact top bar so the next search is one keystroke away.
//
// All chain calls go through /api/explorer (public RPCs send no CORS headers, and external calls
// belong server-side regardless). Chains with no keyless tx list (bsc/avalanche/optimism/tron)
// degrade to a "View on explorer" deep-link rather than an error.

interface ExplorerTx {
  hash: string;
  chain: string;
  timestamp: number | null;
  from: string;
  to: string;
  value: number;
  symbol: string;
  fee: number | null;
  status: 'success' | 'failed' | 'pending' | null;
  method: string | null;
  direction: 'in' | 'out' | 'self' | null;
}

// A held token — same shape /api/wallet-tracker {action:'tokens'} returns, reused here so the
// address view can show a Blockscan-style portfolio (net worth + holdings table) alongside the
// transaction list.
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

interface Portfolio {
  tokens: TokenRow[];
  totalUsd: number;
  totalCount: number;
  tooMany: boolean;
  loading: boolean;
  loaded: boolean;
}

/** One chain's USD subtotal for the multi-chain Token-Holdings breakdown cards (EVM addresses). */
interface ChainSubtotal {
  chainId: string;
  usd: number;
  tokenCount: number;
}
interface Breakdown {
  chains: ChainSubtotal[];
  totalUsd: number;
  loading: boolean;
  loaded: boolean;
}

// Chain-family pills. `all` auto-detects; a single-chain family locks detection; `EVM` narrows an
// ambiguous 0x…40 address to the EVM set and reveals a sub-row to pick the specific EVM chain.
// Definitions + resolution/classification live in ./explorerDetect (node-testable).
const EVM_CHAINS = EXPLORER_FAMILIES.find((f) => f.id === 'EVM')?.chains ?? [];

interface Result {
  kind: 'address' | 'tx';
  chain: string;
  query: string;
  transactions: ExplorerTx[];
  transaction: ExplorerTx | null;
  deepLink: string;
  deepLinkOnly?: boolean;
  error?: string;
}

/**
 * Token-row icon with the same real-logo-first fallback cascade as the Wallet Tracker: the balance
 * source's own logo → the chain's native mark → a Trust Wallet logo by contract → a generic
 * chain-tinted initial badge. Broken remote logos walk to the next source via onError.
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
  useEffect(() => setIdx(0), [sources]);
  const src = sources[Math.min(idx, sources.length - 1)];
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- arbitrary per-token hosts + data-URIs. */
    <img
      className="exp-token-icon"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setIdx((i) => (i < sources.length - 1 ? i + 1 : i))}
    />
  );
}

/** Relative "3m ago" / "2h ago" / date for older, from a unix-seconds timestamp. */
function relTime(ts: number | null): string {
  if (!ts) return '—';
  const secs = Math.floor(Date.now() / 1000) - ts;
  if (secs < 60) return `${Math.max(secs, 0)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 30 * 86400) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function ExplorerView() {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('all');
  const [evmChain, setEvmChain] = useState('ethereum');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Show the EVM sub-row when the EVM family is picked, or when auto-detect landed on an EVM chain.
  const showEvmSubrow = family === 'EVM';

  const runSearch = useCallback(
    async (q: string, familyId: string, evm: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      const chain = resolveChain(trimmed, familyId, evm);
      if (!chain) {
        setError('Could not detect a chain for that input. Pick a network below.');
        return;
      }
      const kind = classify(trimmed, chain);
      setError('');
      setLoading(true);

      const cacheKey = `${chain}:${trimmed}`;
      const cached = getExplorerResult<Result>(cacheKey);
      if (cached) setResult(cached);

      try {
        const res = await fetch('/api/explorer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            kind === 'tx'
              ? { action: 'tx', chain, hash: trimmed }
              : { action: 'address', chain, address: trimmed },
          ),
        });
        const data = (await res.json()) as {
          transactions?: ExplorerTx[];
          transaction?: ExplorerTx | null;
          deepLink?: string;
          deepLinkOnly?: boolean;
          error?: string;
        };
        if (!res.ok) {
          setError(data?.error || 'Search failed. Check the address or hash and try again.');
          setResult(null);
          return;
        }
        const next: Result = {
          kind,
          chain,
          query: trimmed,
          transactions: data.transactions ?? [],
          transaction: data.transaction ?? null,
          deepLink: data.deepLink ?? '',
          deepLinkOnly: data.deepLinkOnly,
          error: data.error,
        };
        setResult(next);
        setExplorerResult(cacheKey, next);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query, family, evmChain);
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1200);
    });
  };

  const hasResult = !!result;

  return (
    <div className={'exp-page' + (hasResult ? ' has-result' : '')}>
      <div className={'exp-hero' + (hasResult ? ' compact' : '')}>
        {!hasResult && (
          <div className="exp-hero-head">
            <h1 className="exp-hero-title">Explorer</h1>
            <p className="exp-hero-sub">
              Search transactions across EVM, Solana, SUI, Cardano &amp; NEAR
            </p>
          </div>
        )}

        <form className="exp-search" onSubmit={onSubmit}>
          <span className="exp-search-icon">
            <Icon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            className="exp-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Address or Transaction Hash…"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="exp-search-btn" type="submit" disabled={loading || !query.trim()}>
            {loading ? '…' : 'Search'}
          </button>
        </form>

        <div className="exp-family-pills">
          {EXPLORER_FAMILIES.map((f) => (
            <button
              key={f.id}
              type="button"
              className={'exp-family-pill' + (family === f.id ? ' active' : '')}
              onClick={() => {
                setFamily(f.id);
                // Re-run immediately if there's already a query, so switching family updates results.
                if (query.trim() && hasResult) void runSearch(query, f.id, evmChain);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {showEvmSubrow && (
          <div className="exp-evm-subrow">
            {EVM_CHAINS.map((id) => {
              const c = getChain(id);
              if (!c) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className={'exp-evm-chip' + (evmChain === id ? ' active' : '')}
                  onClick={() => {
                    setEvmChain(id);
                    if (query.trim() && hasResult) void runSearch(query, 'EVM', id);
                  }}
                >
                  <ChainIcon chain={c} size={18} />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="exp-error">{error}</p>}
      </div>

      {result && <ResultPanel result={result} onCopy={copy} copied={copied} />}
    </div>
  );
}

function ResultPanel({
  result,
  onCopy,
  copied,
}: {
  result: Result;
  onCopy: (t: string) => void;
  copied: string | null;
}) {
  const chain = getChain(result.chain);
  // Address view: Blockscan-style Portfolio | Transactions tabs. Tx view: the field grid only.
  const [tab, setTab] = useState<'portfolio' | 'transactions'>('portfolio');
  const isAddress = result.kind === 'address';
  const portfolioKey = `portfolio:${result.chain}:${result.query}`;

  // Seed from the session cache so re-opening the same address paints instantly; the fetch below
  // still refreshes it. Cache-first is what makes a revisit feel as fast as Blockscan.
  const [portfolio, setPortfolio] = useState<Portfolio>(
    () =>
      getExplorerResult<Portfolio>(portfolioKey) ?? {
        tokens: [],
        totalUsd: 0,
        totalCount: 0,
        tooMany: false,
        loading: false,
        loaded: false,
      },
  );

  // One fetch per address, keyed by chain:query. Keyed off result identity ONLY — never off the
  // loading/loaded flags, or setting loading:true would re-run this effect, whose cleanup cancels the
  // in-flight request and strands "Loading holdings…" forever (the bug this replaces). A client-side
  // timeout guarantees the spinner always resolves even if the upstream stalls.
  useEffect(() => {
    if (!isAddress) return;
    setTab('portfolio');

    const cached = getExplorerResult<Portfolio>(portfolioKey);
    if (cached?.loaded) {
      setPortfolio(cached);
      return; // already have it — no refetch needed for this session
    }

    let cancelled = false;
    setPortfolio({ tokens: [], totalUsd: 0, totalCount: 0, tooMany: false, loading: true, loaded: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    void (async () => {
      try {
        const res = await fetch('/api/wallet-tracker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tokens', address: result.query, chain: result.chain }),
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          tokens?: TokenRow[];
          totalUsd?: number;
          totalCount?: number;
          tooMany?: boolean;
        };
        if (cancelled) return;
        const next: Portfolio = {
          tokens: data.tokens ?? [],
          totalUsd: data.totalUsd ?? 0,
          totalCount: data.totalCount ?? data.tokens?.length ?? 0,
          tooMany: Boolean(data.tooMany),
          loading: false,
          loaded: true,
        };
        setPortfolio(next);
        setExplorerResult(portfolioKey, next);
      } catch {
        if (!cancelled)
          setPortfolio({ tokens: [], totalUsd: 0, totalCount: 0, tooMany: false, loading: false, loaded: true });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // portfolioKey encodes result.chain+result.query; result.query/result.chain are listed so the
    // linter sees them, but they change in lockstep with portfolioKey. Deliberately NOT keyed off the
    // loading/loaded flags — that re-ran the effect and cancelled the in-flight fetch (the bug fixed).
  }, [portfolioKey, isAddress, result.query, result.chain]);

  // Multi-chain Token-Holdings breakdown cards. An EVM address exists on every EVM chain (same
  // format), so its net worth is spread across them; we fan the priced `tokens` lookup out across all
  // EVM chains in parallel and show a card per chain with its USD subtotal + portfolio %. Non-EVM
  // families are single-chain, so their breakdown is just the one chain (fed from `portfolio`).
  const isEvmAddress = isAddress && EVM_CHAINS.includes(result.chain);
  const breakdownKey = `breakdown:${result.chain}:${result.query}`;
  const [breakdown, setBreakdown] = useState<Breakdown>(
    () => getExplorerResult<Breakdown>(breakdownKey) ?? { chains: [], totalUsd: 0, loading: false, loaded: false },
  );

  useEffect(() => {
    if (!isEvmAddress) return;
    const cached = getExplorerResult<Breakdown>(breakdownKey);
    if (cached?.loaded) {
      setBreakdown(cached);
      return;
    }
    let cancelled = false;
    setBreakdown({ chains: [], totalUsd: 0, loading: true, loaded: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    void (async () => {
      const results = await Promise.all(
        EVM_CHAINS.map(async (cid): Promise<ChainSubtotal> => {
          try {
            const res = await fetch('/api/wallet-tracker', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'tokens', address: result.query, chain: cid }),
              signal: controller.signal,
            });
            const d = (await res.json()) as { totalUsd?: number; totalCount?: number };
            return { chainId: cid, usd: d.totalUsd ?? 0, tokenCount: d.totalCount ?? 0 };
          } catch {
            return { chainId: cid, usd: 0, tokenCount: 0 };
          }
        }),
      );
      if (cancelled) return;
      const chains = results.sort((a, b) => b.usd - a.usd);
      const totalUsd = chains.reduce((s, c) => s + c.usd, 0);
      const next: Breakdown = { chains, totalUsd, loading: false, loaded: true };
      setBreakdown(next);
      setExplorerResult(breakdownKey, next);
      clearTimeout(timer);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [breakdownKey, isEvmAddress, result.query, result.chain]);

  if (!chain) return null;

  return (
    <div className="exp-result">
      <div className="exp-result-header">
        <ChainIcon chain={chain} size={40} />
        <div className="exp-result-head-main">
          <div className="exp-result-kind">
            {isAddress ? 'Address' : 'Transaction'} · {chain.label}
          </div>
          <button className="exp-result-addr" onClick={() => onCopy(result.query)} title="Copy">
            <span className="exp-result-addr-text">
              {result.query}
            </span>
            <Icon name={copied === result.query ? 'check' : 'copy'} size={14} />
          </button>
        </div>
        {isAddress && (
          <div className="exp-networth">
            <span className="exp-networth-label">Net Worth</span>
            <span className="exp-networth-value">
              {portfolio.loading && !portfolio.loaded ? '—' : fmtUsdVal(portfolio.totalUsd)}
            </span>
          </div>
        )}
        {result.deepLink && (
          <a className="exp-deeplink" href={result.deepLink} target="_blank" rel="noopener noreferrer">
            <span>View on explorer</span>
            <Icon name="external-link" size={14} />
          </a>
        )}
      </div>

      {isAddress ? (
        <>
          <div className="exp-tabs">
            <button
              className={'exp-tab' + (tab === 'portfolio' ? ' active' : '')}
              onClick={() => setTab('portfolio')}
            >
              Portfolio
            </button>
            <button
              className={'exp-tab' + (tab === 'transactions' ? ' active' : '')}
              onClick={() => setTab('transactions')}
            >
              Transactions
            </button>
          </div>
          {tab === 'portfolio' ? (
            <PortfolioTab
              portfolio={portfolio}
              chain={chain}
              breakdown={isEvmAddress ? breakdown : null}
            />
          ) : (
            <TxList
              txns={result.transactions}
              chain={chain}
              deepLinkOnly={result.deepLinkOnly}
              deepLink={result.deepLink}
            />
          )}
        </>
      ) : (
        <TxDetail tx={result.transaction} chain={chain} deepLinkOnly={result.deepLinkOnly} />
      )}
    </div>
  );
}

/** How many breakdown cards show before "Show N more chains". Matches Blockscan's collapsed grid. */
const BREAKDOWN_COLLAPSED = 12;

function ChainBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const [expanded, setExpanded] = useState(false);
  const total = breakdown.totalUsd;
  // Chains with any value/tokens first (sorted by USD upstream), empty chains after — so the
  // collapsed view leads with the funded chains, exactly like Blockscan.
  const funded = breakdown.chains.filter((c) => c.usd > 0 || c.tokenCount > 0);
  const empty = breakdown.chains.filter((c) => c.usd <= 0 && c.tokenCount <= 0);
  const ordered = [...funded, ...empty];
  const hidden = Math.max(0, ordered.length - BREAKDOWN_COLLAPSED);
  const shown = expanded ? ordered : ordered.slice(0, BREAKDOWN_COLLAPSED);

  return (
    <div className="exp-breakdown">
      <div className="exp-breakdown-head">
        <span className="exp-breakdown-title">Token Holdings</span>
        <span className="exp-breakdown-badge">{ordered.length} chains</span>
        {breakdown.loading && <span className="exp-breakdown-loading">updating…</span>}
      </div>
      <div className="exp-breakdown-grid">
        {shown.map((c) => {
          const chn = getChain(c.chainId);
          if (!chn) return null;
          const pct = total > 0 ? (c.usd / total) * 100 : 0;
          const pctLabel = c.usd <= 0 ? '(0%)' : pct >= 1 ? `(${pct.toFixed(0)}%)` : '(< 1%)';
          return (
            <div key={c.chainId} className="exp-breakdown-card">
              <div className="exp-breakdown-card-top">
                <ChainIcon chain={chn} size={18} />
                <span className="exp-breakdown-card-name">{chn.label}</span>
                {c.tokenCount > 0 && <span className="exp-breakdown-card-count">({c.tokenCount})</span>}
              </div>
              <div className="exp-breakdown-card-val">
                {fmtUsdVal(c.usd)} <span className="exp-breakdown-card-pct">{pctLabel}</span>
              </div>
            </div>
          );
        })}
        {hidden > 0 && (
          <button className="exp-breakdown-toggle" onClick={() => setExpanded((v) => !v)}>
            <Icon name={expanded ? 'chevron-left' : 'plus'} size={14} />
            <span>{expanded ? 'Hide' : `Show ${hidden} more`} chains</span>
          </button>
        )}
      </div>
    </div>
  );
}

function PortfolioTab({
  portfolio,
  chain,
  breakdown,
}: {
  portfolio: Portfolio;
  chain: Chain;
  breakdown: Breakdown | null;
}) {
  if (portfolio.loading && !portfolio.loaded) {
    return <div className="exp-empty"><p>Loading holdings…</p></div>;
  }
  if (portfolio.tooMany) {
    return (
      <div className="exp-empty">
        <p>This address holds too many tokens to enumerate. Open it on {chain.label}&apos;s explorer.</p>
      </div>
    );
  }
  const priced = portfolio.tokens.filter((t) => t.usdValue > 0);
  // Chains with no keyless price feed (Solana SPL, Sui, Cardano, NEAR non-native) return every token
  // at usdValue 0; a whale can hold thousands. Cap the unpriced tail so the table stays usable —
  // native coin first, then the rest by balance.
  const UNPRICED_CAP = 50;
  const unpriced = portfolio.tokens
    .filter((t) => t.usdValue <= 0 && t.balance > 0)
    .sort((a, b) => (a.type === 'native' ? -1 : b.type === 'native' ? 1 : 0));
  const unpricedShown = unpriced.slice(0, UNPRICED_CAP);
  const hiddenUnpriced = unpriced.length - unpricedShown.length;
  const rows = [...priced, ...unpricedShown];
  if (!rows.length) {
    return <div className="exp-empty"><p>No token holdings found for this address.</p></div>;
  }
  const total = portfolio.totalUsd;
  return (
    <div className="exp-holdings">
      {breakdown && breakdown.chains.length > 0 && <ChainBreakdown breakdown={breakdown} />}
      <div className="exp-holdings-meta">
        Showing {rows.length} token{rows.length === 1 ? '' : 's'}
        {portfolio.totalCount > rows.length ? ` of ${portfolio.totalCount}` : ''} worth {fmtUsdVal(total)}
        {hiddenUnpriced > 0 ? ` · ${hiddenUnpriced} unpriced token${hiddenUnpriced === 1 ? '' : 's'} hidden` : ''}
      </div>
      <div className="exp-holdings-table">
        <div className="exp-holdings-head">
          <span>Token</span>
          <span className="exp-h-pct">Portfolio %</span>
          <span className="exp-h-price">Price</span>
          <span className="exp-h-amount">Amount</span>
          <span className="exp-h-value">Value</span>
        </div>
        {rows.map((t, i) => {
          const pct = total > 0 ? (t.usdValue / total) * 100 : 0;
          const isNative = t.type === 'native';
          return (
            <div key={t.contractAddress || t.symbol + i} className="exp-holdings-row">
              <span className="exp-h-token">
                <TokenIcon
                  chainId={chain.id}
                  symbol={t.symbol}
                  thumb={t.thumb}
                  contractAddress={t.contractAddress}
                  isNative={isNative}
                />
                <span className="exp-h-token-text">
                  <span className="exp-h-token-name">{t.name || t.symbol}</span>
                  <span className="exp-h-token-sym">{t.symbol}</span>
                </span>
              </span>
              <span className="exp-h-pct">{t.usdValue > 0 ? pct.toFixed(pct < 0.01 ? 4 : 2) + '%' : '—'}</span>
              <span className="exp-h-price">{t.price > 0 ? fmtUsdVal(t.price) : '—'}</span>
              <span className="exp-h-amount">{fmtBal(t.balance)}</span>
              <span className="exp-h-value">{t.usdValue > 0 ? fmtUsdVal(t.usdValue) : '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TxList({
  txns,
  chain,
  deepLinkOnly,
  deepLink,
}: {
  txns: ExplorerTx[];
  chain: Chain;
  deepLinkOnly?: boolean;
  deepLink: string;
}) {
  if (deepLinkOnly) {
    return (
      <div className="exp-empty">
        <p>
          Inline transaction history isn&apos;t available keyless for {chain.label}. Open the address
          on {chain.label}&apos;s explorer to view its transactions.
        </p>
        <a className="exp-deeplink big" href={deepLink} target="_blank" rel="noopener noreferrer">
          <span>Open on {chain.label} explorer</span>
          <Icon name="external-link" size={16} />
        </a>
      </div>
    );
  }
  if (!txns.length) {
    return <div className="exp-empty"><p>No recent transactions found for this address.</p></div>;
  }
  return (
    <div className="exp-tx-list">
      {txns.map((tx) => (
        <TxRow key={tx.hash} tx={tx} chain={chain} />
      ))}
    </div>
  );
}

function TxRow({ tx, chain }: { tx: ExplorerTx; chain: Chain }) {
  const dir = tx.direction ?? 'self';
  const counterparty = tx.direction === 'in' ? tx.from : tx.to;
  const url = txUrlClient(chain, tx.hash);
  return (
    <a className={'exp-tx-row ' + dir} href={url} target="_blank" rel="noopener noreferrer">
      <span className={'exp-tx-arrow ' + dir}>
        <Icon name="arrow-up-down" size={16} />
      </span>
      <div className="exp-tx-main">
        <div className="exp-tx-line1">
          <span className="exp-tx-method">{tx.method || 'Transfer'}</span>
          {tx.status === 'failed' && <span className="exp-tx-failed">Failed</span>}
        </div>
        <div className="exp-tx-line2">
          <span className="exp-tx-hash">{truncAddr(tx.hash)}</span>
          {counterparty && (
            <span className="exp-tx-cp">
              {tx.direction === 'in' ? 'from' : 'to'} {truncAddr(counterparty)}
            </span>
          )}
        </div>
      </div>
      <div className="exp-tx-right">
        {tx.value > 0 && (
          <span className={'exp-tx-value ' + dir}>
            {dir === 'out' ? '−' : dir === 'in' ? '+' : ''}
            {fmtBal(tx.value)} {tx.symbol}
          </span>
        )}
        <span className="exp-tx-time">
          <Icon name="clock" size={12} /> {relTime(tx.timestamp)}
        </span>
      </div>
    </a>
  );
}

function TxDetail({
  tx,
  chain,
  deepLinkOnly,
}: {
  tx: ExplorerTx | null;
  chain: Chain;
  deepLinkOnly?: boolean;
}) {
  if (deepLinkOnly || !tx) {
    return (
      <div className="exp-empty">
        <p>
          {deepLinkOnly
            ? `Transaction detail isn't available keyless for ${chain.label}.`
            : 'Transaction not found. It may be too recent, or on a different network.'}
        </p>
      </div>
    );
  }
  const rows: [string, React.ReactNode][] = [
    ['Status', <span key="s" className={'exp-status ' + (tx.status ?? 'pending')}>{tx.status ?? 'pending'}</span>],
    ['Timestamp', tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : '—'],
    ['From', tx.from ? truncAddr(tx.from) : '—'],
    ['To', tx.to ? truncAddr(tx.to) : '—'],
    ['Value', tx.value > 0 ? `${fmtBal(tx.value)} ${tx.symbol}` : `0 ${tx.symbol}`],
    ['Fee', tx.fee != null ? `${fmtBal(tx.fee)} ${tx.symbol}` : '—'],
    ['Method', tx.method || '—'],
  ];
  return (
    <div className="exp-tx-detail">
      {rows.map(([label, val]) => (
        <div key={label} className="exp-detail-row">
          <span className="exp-detail-label">{label}</span>
          <span className="exp-detail-val">{val}</span>
        </div>
      ))}
    </div>
  );
}
