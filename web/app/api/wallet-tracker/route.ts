import { NextResponse } from 'next/server';
import { BLOCKSCOUT_HOSTS } from './hosts';

// On-chain wallet tracker — ported from Reach's `walletTracker:*` IPC handlers (electron/main.js).
//
// Every upstream here is an unauthenticated public endpoint (Blockscout, chain RPCs, TronGrid,
// CoinGecko's free tier); Reach uses no API key and neither does this. They still have to be called
// server-side: public RPCs don't send CORS headers, and CLAUDE.md forbids external calls from the
// client regardless.
//
// One POST with an `action` discriminator rather than three routes — the three actions share the
// chain config and HTTP helpers, and the client only ever calls them from one component.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChainType = 'evm' | 'solana' | 'tron' | 'near';

interface ChainCfg {
  rpc: string;
  type: ChainType;
  decimals: number;
  cgId: string;
  /** Native token ticker — Blockscout doesn't report it, so it's hardcoded as in Reach. */
  native: string;
}

// EVM RPCs are all publicnode: Reach's originals have rotted since it was written — rpc.ankr.com/eth
// and polygon-rpc.com now reject keyless traffic ("Unauthorized" / "API key disabled"), leaving those
// chains with no working fallback. publicnode serves eth_getBalance keyless on all seven (verified).
const CHAINS: Record<string, ChainCfg> = {
  ethereum: { rpc: 'https://ethereum-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  bsc: { rpc: 'https://bsc-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'binancecoin', native: 'BNB' },
  // 'polygon-ecosystem-token' (POL), not the old 'matic-network' — CoinGecko retired the MATIC id in
  // the POL migration and now answers it with an empty object, which silently priced every Polygon
  // wallet at $0.00 while its native balance still rendered.
  polygon: { rpc: 'https://polygon-bor-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'polygon-ecosystem-token', native: 'POL' },
  arbitrum: { rpc: 'https://arbitrum-one-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  optimism: { rpc: 'https://optimism-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  base: { rpc: 'https://base-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  avalanche: { rpc: 'https://avalanche-c-chain-rpc.publicnode.com', type: 'evm', decimals: 18, cgId: 'avalanche-2', native: 'AVAX' },
  solana: { rpc: 'https://api.mainnet-beta.solana.com', type: 'solana', decimals: 9, cgId: 'solana', native: 'SOL' },
  tron: { rpc: 'https://api.trongrid.io', type: 'tron', decimals: 6, cgId: 'tron', native: 'TRX' },
  near: { rpc: 'https://rpc.mainnet.near.org', type: 'near', decimals: 24, cgId: 'near', native: 'NEAR' },
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 10_000;
// Blockscout's token-balances payload is unbounded — a long-lived address like Vitalik's returns
// ~3MB / 7.9k entries and takes ~6s. The default timeout clipped it, silently yielding "0 tokens".
const SLOW_TIMEOUT_MS = 25_000;

async function fetchJSON(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * TronGrid rate-limits keyless callers to ~1 request/second and suspends the caller for several
 * seconds on a breach. The tracker fires every wallet's balance lookup in parallel, so two Tron
 * addresses are enough to trip it. Serialise Tron calls behind a promise chain, spacing them out.
 */
const TRON_MIN_GAP_MS = 1100;
let tronQueue: Promise<unknown> = Promise.resolve();

function tronFetch(url: string): Promise<unknown> {
  const run = tronQueue.then(async () => {
    const out = await fetchJSON(url);
    await new Promise((r) => setTimeout(r, TRON_MIN_GAP_MS));
    return out;
  });
  // Keep the chain alive even if one call rejects, or every later Tron lookup inherits the failure.
  tronQueue = run.catch(() => undefined);
  return run;
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
 * Addresses are pasted by the user and interpolated straight into upstream URLs, so they get
 * validated per chain rather than trusted. Reach skips this — it can afford to, being a local
 * desktop app; a public web route cannot.
 */
function validAddress(address: string, type: ChainType): boolean {
  if (type === 'evm') return /^0x[a-fA-F0-9]{40}$/.test(address);
  if (type === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (type === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (type === 'near') return /^[a-z0-9._-]{2,64}$/.test(address);
  return false;
}

/** Divides a raw integer balance by its decimals without going through a lossy Number cast. */
function fromUnits(raw: bigint, decimals: number): number {
  const d = BigInt(10) ** BigInt(decimals);
  const whole = raw / d;
  const frac = raw % d;
  return Number(whole) + Number(frac) / Number(d);
}

async function getBalance(address: string, chain: string) {
  const cfg = CHAINS[chain];
  if (!cfg) return { balance: 0, error: 'Unknown chain' };

  if (cfg.type === 'evm') {
    // Blockscout first — it's more reliable than the public RPCs and needs no key. RPC is the fallback.
    const host = BLOCKSCOUT_HOSTS[chain];
    if (host) {
      try {
        const res = (await fetchJSON(`https://${host}/api/v2/addresses/${address}`)) as {
          coin_balance?: string;
        };
        if (res?.coin_balance) return { balance: fromUnits(BigInt(res.coin_balance), cfg.decimals) };
      } catch {
        /* fall through to RPC */
      }
    }
    const res = await rpc(cfg.rpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    });
    return { balance: fromUnits(BigInt((res.result as string) || '0x0'), cfg.decimals) };
  }

  if (cfg.type === 'solana') {
    const res = await rpc(cfg.rpc, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] });
    const value = (res.result as { value?: number })?.value ?? 0;
    return { balance: value / 10 ** cfg.decimals };
  }

  if (cfg.type === 'tron') {
    const res = (await tronFetch(`https://api.trongrid.io/v1/accounts/${address}`)) as {
      data?: { balance?: number }[];
    };
    return { balance: (res?.data?.[0]?.balance || 0) / 10 ** cfg.decimals };
  }

  if (cfg.type === 'near') {
    const res = await rpc(cfg.rpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: address },
    });
    const amount = (res.result as { amount?: string })?.amount || '0';
    return { balance: fromUnits(BigInt(amount), cfg.decimals) };
  }

  return { balance: 0 };
}

export interface TrackedToken {
  symbol: string;
  name: string;
  balance: number;
  usdValue: number;
  price: number;
  type: string;
  thumb: string;
  contractAddress: string;
}

/** Most tokens a wallet detail view will return — see the sort/cap note in getTokens. */
const MAX_TOKENS = 100;

async function getTokens(address: string, chain: string) {
  const cfg = CHAINS[chain];
  if (!cfg) return { tokens: [], totalUsd: 0 };

  if (cfg.type === 'evm') {
    const host = BLOCKSCOUT_HOSTS[chain];
    if (!host) return { tokens: [], totalUsd: 0 };

    const [addrRes, tokRes] = await Promise.all([
      fetchJSON(`https://${host}/api/v2/addresses/${address}`) as Promise<{
        coin_balance?: string;
        exchange_rate?: string;
      }>,
      fetchJSON(
        `https://${host}/api/v2/addresses/${address}/token-balances`,
        SLOW_TIMEOUT_MS,
      ) as Promise<
        {
          value?: string;
          token?: Record<string, string>;
        }[]
      >,
    ]);

    const tokens: TrackedToken[] = [];
    const nativeBal = addrRes?.coin_balance
      ? fromUnits(BigInt(addrRes.coin_balance), cfg.decimals)
      : 0;
    const nativePrice = parseFloat(addrRes?.exchange_rate ?? '') || 0;
    tokens.push({
      symbol: cfg.native,
      name: cfg.native,
      balance: nativeBal,
      usdValue: nativeBal * nativePrice,
      price: nativePrice,
      type: 'native',
      thumb: '',
      contractAddress: '',
    });

    if (Array.isArray(tokRes)) {
      for (const t of tokRes) {
        const tok = t.token || {};
        if (tok.type !== 'ERC-20') continue;
        const decimals = parseInt(tok.decimals) || 18;
        const bal = fromUnits(BigInt(t.value || '0'), decimals);
        if (bal <= 0) continue;
        const price = parseFloat(tok.exchange_rate) || 0;
        tokens.push({
          symbol: tok.symbol || '???',
          name: tok.name || tok.symbol || '???',
          balance: bal,
          usdValue: bal * price,
          price,
          type: 'ERC-20',
          thumb: tok.icon_url || '',
          contractAddress: tok.address_hash || '',
        });
      }
    }

    // Sort by value, then cap. A long-lived address accrues thousands of unpriced airdrop tokens
    // (Vitalik's holds ~6.6k); shipping them all would be a multi-MB response that buries the real
    // holdings. The total is summed over everything *before* the cap, so it stays accurate.
    tokens.sort((a, b) => b.usdValue - a.usdValue);
    const totalUsd = tokens.reduce((s, t) => s + t.usdValue, 0);
    const truncated = tokens.length > MAX_TOKENS;
    return {
      tokens: tokens.slice(0, MAX_TOKENS),
      totalUsd,
      truncated,
      totalCount: tokens.length,
    };
  }

  if (cfg.type === 'solana') {
    const [balRes, tokRes] = await Promise.all([
      rpc(cfg.rpc, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
      rpc(cfg.rpc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' },
        ],
      }),
    ]);

    const solBal = ((balRes.result as { value?: number })?.value ?? 0) / 1e9;
    // SPL tokens carry no price here (as in Reach) — Solana has no Blockscout-style rate feed.
    const tokens: TrackedToken[] = [
      { symbol: 'SOL', name: 'Solana', balance: solBal, usdValue: 0, price: 0, type: 'native', thumb: '', contractAddress: '' },
    ];

    const accounts =
      ((tokRes.result as { value?: unknown[] })?.value as {
        account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmountString?: string } } } } };
      }[]) ?? [];
    for (const acc of accounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      const amt = parseFloat(info.tokenAmount?.uiAmountString || '0');
      if (amt > 0) {
        tokens.push({
          symbol: info.mint?.slice(0, 8) || '???',
          name: info.mint || '',
          balance: amt,
          usdValue: 0,
          price: 0,
          type: 'SPL',
          thumb: '',
          contractAddress: info.mint || '',
        });
      }
    }
    return { tokens, totalUsd: 0 };
  }

  if (cfg.type === 'tron') {
    const res = (await tronFetch(`https://api.trongrid.io/v1/accounts/${address}`)) as {
      data?: { balance?: number; trc20?: Record<string, string>[] }[];
    };
    const acc = res?.data?.[0];
    const trxBal = (acc?.balance || 0) / 1e6;
    const tokens: TrackedToken[] = [
      { symbol: 'TRX', name: 'Tron', balance: trxBal, usdValue: 0, price: 0, type: 'native', thumb: '', contractAddress: '' },
    ];
    for (const tok of acc?.trc20 || []) {
      for (const [addr, bal] of Object.entries(tok)) {
        const rawBal = parseInt(bal) / 1e6;
        if (rawBal > 0) {
          tokens.push({
            symbol: addr.slice(0, 8),
            name: addr,
            balance: rawBal,
            usdValue: 0,
            price: 0,
            type: 'TRC-20',
            thumb: '',
            contractAddress: addr,
          });
        }
      }
    }
    return { tokens, totalUsd: 0 };
  }

  // Near has no token endpoint in Reach either — native balance only.
  return { tokens: [], totalUsd: 0 };
}

// CoinGecko's free tier rate-limits hard, and every tracked wallet refresh asks for the same handful
// of native-token prices. Cache them.
const PRICE_TTL_MS = 60_000;
let priceCache: { at: number; data: unknown } | null = null;

async function getPrices() {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.data;
  const ids = [...new Set(Object.values(CHAINS).map((c) => c.cgId))].join(',');
  try {
    const res = await fetchJSON(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    );
    priceCache = { at: Date.now(), data: res || {} };
    return priceCache.data;
  } catch {
    // Serve a stale quote over none — a 429 shouldn't blank every card's USD value.
    return priceCache?.data ?? {};
  }
}

export async function POST(req: Request) {
  let body: { action?: string; address?: string; chain?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { action } = body;

  if (action === 'prices') {
    return NextResponse.json(await getPrices());
  }

  if (action === 'balance' || action === 'tokens') {
    const chain = String(body.chain ?? '');
    const address = String(body.address ?? '').trim();
    const cfg = CHAINS[chain];
    if (!cfg) return NextResponse.json({ error: 'Unknown chain' }, { status: 400 });
    if (!validAddress(address, cfg.type)) {
      return NextResponse.json({ error: 'Invalid address for this chain' }, { status: 400 });
    }

    try {
      const data = action === 'balance' ? await getBalance(address, chain) : await getTokens(address, chain);
      return NextResponse.json(data);
    } catch {
      // Never surface the upstream error text — it can carry internal URLs. Degrade to an empty result.
      return action === 'balance'
        ? NextResponse.json({ balance: 0, error: 'Lookup failed' })
        : NextResponse.json({ tokens: [], totalUsd: 0, error: 'Lookup failed' });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
