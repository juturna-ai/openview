import { NextResponse } from 'next/server';
import {
  CHAIN_FAMILIES,
  EXPLORER_CHAINS,
  isDeepLinkOnly,
  type ExplorerChainType,
} from './chains.server';
import {
  normalizeBlockscout,
  normalizeCardano,
  normalizeNear,
  normalizeSolanaSig,
  normalizeSui,
  txUrl,
  validHash,
  type ExplorerTx,
} from './normalize';

// Multi-chain transaction Explorer — search a tx hash or an address' recent transactions across
// EVM (Blockscout), Solana, Sui, Cardano and NEAR. Companion to ../wallet-tracker/route.ts (which
// does balances/tokens); this does *transactions*, reusing the same keyless public providers.
//
// One POST with an `action` discriminator, same shape as the wallet-tracker route: the two actions
// share the chain config and HTTP helpers, and the client calls them from one component.
//
// Every upstream is an unauthenticated public endpoint. They're called server-side because public
// RPCs send no CORS headers and CLAUDE.md forbids external calls from the client regardless. Upstream
// error text is never surfaced (it can carry internal URLs) — failures degrade to an empty result.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12_000;

/** Most transactions returned for an address history — keeps payloads and fan-out bounded. */
const MAX_TXNS = 25;

async function fetchJSON(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function rpc(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Addresses are pasted by the user and interpolated into upstream URLs, so they're validated per
 * chain rather than trusted — same set as the wallet-tracker route's validAddress.
 */
function validAddress(address: string, type: ExplorerChainType): boolean {
  if (type === 'evm') return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (type === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (type === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (type === 'near') return /^[a-z0-9._-]{2,64}$/.test(address);
  if (type === 'sui') return /^0x[a-fA-F0-9]{64}$/.test(address);
  if (type === 'cardano') return /^addr1[a-z0-9]{20,}$/.test(address);
  // Deep-link-only families (no inline tx list) — validated so their addresses resolve to a
  // deep-link + a working Portfolio tab instead of "Unknown/Invalid chain". Same regexes as the
  // wallet-tracker route's validAddress.
  if (type === 'hyperliquid') return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (type === 'injective') return /^inj1[a-z0-9]{20,}$/.test(address);
  if (type === 'hedera') return /^\d{1,10}\.\d{1,10}\.\d{1,12}$/.test(address);
  if (type === 'bittensor') return /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(address);
  return false;
}

// ── Address history per chain ────────────────────────────────────────────────────────────────

async function evmHistory(address: string, chainId: string): Promise<ExplorerTx[]> {
  const host = EXPLORER_CHAINS[chainId]?.blockscout;
  if (!host) return [];
  // Blockscout returns both incoming and outgoing txns by default; the `?filter=to | from` param it
  // documents actually 422s, so it's omitted.
  const res = (await fetchJSON(
    `https://${host}/api/v2/addresses/${address}/transactions`,
  )) as { items?: unknown[] };
  const items = Array.isArray(res?.items) ? res.items : [];
  return items.slice(0, MAX_TXNS).map((it) => normalizeBlockscout(it as never, chainId, address));
}

async function solanaHistory(address: string, chainId: string): Promise<ExplorerTx[]> {
  const rpcUrl = EXPLORER_CHAINS[chainId]?.rpc as string;
  const res = await rpc(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignaturesForAddress',
    params: [address, { limit: MAX_TXNS }],
  });
  const sigs = (res.result as unknown[]) ?? [];
  return sigs.map((s) => normalizeSolanaSig(s as never, address));
}

async function suiHistory(address: string, chainId: string): Promise<ExplorerTx[]> {
  const rpcUrl = EXPLORER_CHAINS[chainId]?.rpc as string;
  // Query blocks sent FROM the address (the common case). Sui splits by From/To filters; From covers
  // the address' own activity, which is what a history view most wants.
  const res = await rpc(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'suix_queryTransactionBlocks',
    params: [
      { filter: { FromAddress: address }, options: { showEffects: true, showInput: true } },
      null,
      MAX_TXNS,
      true, // descending: newest first
    ],
  });
  const data = (res.result as { data?: unknown[] })?.data ?? [];
  return data.map((d) => normalizeSui(d as never, address));
}

async function cardanoHistory(address: string, chainId: string): Promise<ExplorerTx[]> {
  const rpcUrl = EXPLORER_CHAINS[chainId]?.rpc as string;
  const res = (await rpc(`${rpcUrl}/address_txs`, { _addresses: [address] })) as unknown as {
    tx_hash?: string;
    tx_timestamp?: number;
    block_time?: number;
  }[];
  const list = Array.isArray(res) ? res : [];
  // Koios returns oldest→newest; take the most recent MAX_TXNS.
  return list
    .slice(-MAX_TXNS)
    .reverse()
    .map((t) => normalizeCardano(t));
}

async function nearHistory(address: string): Promise<ExplorerTx[]> {
  const rpcUrl = EXPLORER_CHAINS.near.rpc as string;
  // nearblocks returns newest-first already; adding `&order=desc` makes the host drop the connection
  // (HTTP 000), so only `per_page` is passed.
  const res = (await fetchJSON(
    `${rpcUrl}/v1/account/${address}/txns?per_page=${MAX_TXNS}`,
  )) as { txns?: unknown[] };
  const txns = Array.isArray(res?.txns) ? res.txns : [];
  return txns.slice(0, MAX_TXNS).map((t) => normalizeNear(t as never, address));
}

async function getHistory(address: string, chainId: string): Promise<ExplorerTx[]> {
  const cfg = EXPLORER_CHAINS[chainId];
  if (!cfg) return [];
  if (cfg.type === 'evm') return evmHistory(address, chainId);
  if (cfg.type === 'solana') return solanaHistory(address, chainId);
  if (cfg.type === 'sui') return suiHistory(address, chainId);
  if (cfg.type === 'cardano') return cardanoHistory(address, chainId);
  if (cfg.type === 'near') return nearHistory(address);
  return [];
}

// ── Single-tx detail per chain ───────────────────────────────────────────────────────────────

async function getTx(hash: string, chainId: string): Promise<ExplorerTx | null> {
  const cfg = EXPLORER_CHAINS[chainId];
  if (!cfg) return null;

  if (cfg.type === 'evm') {
    if (!cfg.blockscout) return null;
    const res = (await fetchJSON(
      `https://${cfg.blockscout}/api/v2/transactions/${hash}`,
    )) as Record<string, unknown>;
    return normalizeBlockscout(res as never, chainId, '');
  }

  if (cfg.type === 'solana') {
    const res = await rpc(cfg.rpc as string, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [hash, { maxSupportedTransactionVersion: 0, encoding: 'json' }],
    });
    const r = res.result as {
      blockTime?: number | null;
      meta?: { err?: unknown; fee?: number };
      transaction?: { message?: { accountKeys?: string[] } };
    } | null;
    if (!r) return null;
    const keys = r.transaction?.message?.accountKeys ?? [];
    return {
      hash,
      chain: 'solana',
      timestamp: typeof r.blockTime === 'number' ? r.blockTime : null,
      from: keys[0] ?? '',
      to: keys[1] ?? '',
      value: 0,
      symbol: 'SOL',
      fee: typeof r.meta?.fee === 'number' ? r.meta.fee / 1e9 : null,
      status: r.meta?.err ? 'failed' : 'success',
      method: null,
      direction: null,
    };
  }

  if (cfg.type === 'sui') {
    const res = await rpc(cfg.rpc as string, {
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_getTransactionBlock',
      params: [hash, { showEffects: true, showInput: true }],
    });
    const r = res.result;
    if (!r) return null;
    return normalizeSui(r as never, '');
  }

  if (cfg.type === 'cardano') {
    const res = (await rpc(`${cfg.rpc}/tx_info`, { _tx_hashes: [hash] })) as unknown as {
      tx_hash?: string;
      tx_timestamp?: number;
      fee?: string;
    }[];
    const t = Array.isArray(res) ? res[0] : undefined;
    if (!t) return null;
    const base = normalizeCardano(t);
    let fee: number | null = null;
    try {
      if (t.fee) fee = Number(BigInt(t.fee)) / 1e6;
    } catch {
      fee = null;
    }
    return { ...base, fee };
  }

  if (cfg.type === 'near') {
    const res = (await fetchJSON(`${cfg.rpc}/v1/txns/${hash}`)) as { txns?: unknown[] };
    const t = Array.isArray(res?.txns) ? res.txns[0] : undefined;
    if (!t) return null;
    return normalizeNear(t as never, '');
  }

  return null;
}

export async function POST(req: Request) {
  let body: { action?: string; chain?: string; address?: string; hash?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { action } = body;

  if (action === 'families') {
    return NextResponse.json({ families: CHAIN_FAMILIES });
  }

  const chain = String(body.chain ?? '');
  const cfg = EXPLORER_CHAINS[chain];
  if (!cfg) return NextResponse.json({ error: 'Unknown chain' }, { status: 400 });

  if (action === 'address') {
    const address = String(body.address ?? '').trim();
    if (!validAddress(address, cfg.type)) {
      return NextResponse.json({ error: 'Invalid address for this chain' }, { status: 400 });
    }
    const deepLink = cfg.explorer + address;
    if (isDeepLinkOnly(chain)) {
      return NextResponse.json({ transactions: [], deepLink, deepLinkOnly: true });
    }
    try {
      const transactions = await getHistory(address, chain);
      return NextResponse.json({ transactions, deepLink });
    } catch {
      // Degrade to a deep-link rather than surfacing the upstream failure.
      return NextResponse.json({ transactions: [], deepLink, error: 'Lookup failed' });
    }
  }

  if (action === 'tx') {
    const hash = String(body.hash ?? '').trim();
    if (!validHash(hash, cfg.type)) {
      return NextResponse.json({ error: 'Invalid transaction hash for this chain' }, { status: 400 });
    }
    const deepLink = txUrl(chain, hash);
    if (isDeepLinkOnly(chain)) {
      return NextResponse.json({ transaction: null, deepLink, deepLinkOnly: true });
    }
    try {
      const transaction = await getTx(hash, chain);
      return NextResponse.json({ transaction, deepLink });
    } catch {
      return NextResponse.json({ transaction: null, deepLink, error: 'Lookup failed' });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
