import { NextResponse } from 'next/server';
import { BLOCKSCOUT_HOSTS, MORALIS_CHAINS, parseFtMetadata } from './hosts';

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

type ChainType =
  | 'evm'
  | 'solana'
  | 'tron'
  | 'near'
  | 'hyperliquid'
  | 'cardano'
  | 'sui'
  | 'bittensor'
  | 'injective'
  | 'hedera';

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
  // Additional EVM chains — balance via their keyless Blockscout instance (see BLOCKSCOUT_HOSTS),
  // RPC as fallback. cgId is the CoinGecko id for the native token's USD price.
  gnosis: { rpc: 'https://rpc.gnosischain.com', type: 'evm', decimals: 18, cgId: 'xdai', native: 'XDAI' },
  celo: { rpc: 'https://forno.celo.org', type: 'evm', decimals: 18, cgId: 'celo', native: 'CELO' },
  scroll: { rpc: 'https://rpc.scroll.io', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  zksync: { rpc: 'https://mainnet.era.zksync.io', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  mode: { rpc: 'https://mainnet.mode.network', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  unichain: { rpc: 'https://mainnet.unichain.org', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  zora: { rpc: 'https://rpc.zora.energy', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  // Second EVM widening. Every rpc below answered eth_blockNumber live; every cgId was confirmed
  // against the chain's own reported coin price rather than a CoinGecko name search (which resolves
  // "ink" to Chainlink and "soneium" to a bridged ASTR token). Robinhood/Ink/Soneium/World
  // Chain/LightLink all report ~$1877 = ETH; Etherlink reports ~$0.2228, matching XTZ.
  //
  // Robinhood Chain (an Arbitrum Orbit L2, native ETH per Blockscout's own chain registry) publishes
  // no public RPC — balance comes from its Blockscout host, which getBalance tries FIRST and which is
  // verified working. `rpc` is required by ChainCfg, so it points at the same Blockscout instance's
  // JSON-RPC proxy; if that ever 404s, the Blockscout branch above it has already returned.
  robinhood: { rpc: 'https://robinhoodchain.blockscout.com/api/eth-rpc', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  // SEI and Linea have no keyless Blockscout v2 instance — their token detail comes from Moralis
  // (see MORALIS_CHAINS), which returns balances + USD in one call. Balance still uses these RPCs.
  sei: { rpc: 'https://evm-rpc.sei-apis.com', type: 'evm', decimals: 18, cgId: 'sei-network', native: 'SEI' },
  linea: { rpc: 'https://rpc.linea.build', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  ink: { rpc: 'https://rpc-gel.inkonchain.com', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  soneium: { rpc: 'https://rpc.soneium.org', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  etherlink: { rpc: 'https://node.mainnet.etherlink.com', type: 'evm', decimals: 18, cgId: 'tezos', native: 'XTZ' },
  worldchain: { rpc: 'https://worldchain-mainnet.g.alchemy.com/public', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  lightlink: { rpc: 'https://replicator.phoenix.lightlink.io/rpc/v1', type: 'evm', decimals: 18, cgId: 'ethereum', native: 'ETH' },
  // Sonic — EVM, but the only chain here with NO token index: no keyless Blockscout v2 host
  // (explorer.soniclabs.com serves the HTML explorer, not the API) and Moralis 400s it under every
  // identifier (sonic / 0x92 / 146). getTokens therefore degrades it to the priced native coin.
  // cgId is 'sonic-3' (the S token) — NOT 'fantom', which is the retired FTM id Sonic migrated from
  // and would misprice the whole chain, the same trap the POL/matic-network note above describes.
  sonic: { rpc: 'https://rpc.soniclabs.com', type: 'evm', decimals: 18, cgId: 'sonic-3', native: 'S' },
  solana: { rpc: 'https://api.mainnet-beta.solana.com', type: 'solana', decimals: 9, cgId: 'solana', native: 'SOL' },
  tron: { rpc: 'https://api.trongrid.io', type: 'tron', decimals: 6, cgId: 'tron', native: 'TRX' },
  // rpc.mainnet.near.org was deprecated and now returns HTTP 429 + a "STOP USING IT" warning for
  // every call, which surfaced as "0.00000000 NEAR / $0.00" on every NEAR wallet. FastNEAR is the
  // provider NEAR's own deprecation notice points to — keyless, and it serves both view_account
  // (balances) and call_function (ft_metadata) used by the token detail.
  near: { rpc: 'https://free.rpc.fastnear.com', type: 'near', decimals: 24, cgId: 'near', native: 'NEAR' },
  // ── Chains added beyond Reach's original ten. All keyless, native-balance-only (no token detail):
  // none has a keyless multi-asset index comparable to Blockscout/Moralis, so their detail view shows
  // the native coin row only, same as Solana/Tron do for priced tokens.
  //
  // Hyperliquid uses EVM-format 0x addresses but is NOT an EVM RPC chain — its balance comes from the
  // L1 `info` API, and `.total` there is ALREADY a human-readable decimal string (see getBalance), so
  // `decimals` is 0 and fromUnits is never applied to it. Don't "fix" this to 18.
  hyperliquid: { rpc: 'https://api.hyperliquid.xyz/info', type: 'hyperliquid', decimals: 0, cgId: 'hyperliquid', native: 'HYPE' },
  cardano: { rpc: 'https://api.koios.rest/api/v1', type: 'cardano', decimals: 6, cgId: 'cardano', native: 'ADA' },
  sui: { rpc: 'https://fullnode.mainnet.sui.io:443', type: 'sui', decimals: 9, cgId: 'sui', native: 'SUI' },
  // Bittensor has no keyless HTTP endpoint — balance comes via @polkadot/api over WS, lazily loaded
  // from ./polkadot so no other chain pays that dependency's cost. `rpc` is the WS URL for reference.
  bittensor: { rpc: 'wss://entrypoint-finney.opentensor.ai:443', type: 'bittensor', decimals: 9, cgId: 'bittensor', native: 'TAO' },
  injective: { rpc: 'https://sentry.lcd.injective.network', type: 'injective', decimals: 18, cgId: 'injective-protocol', native: 'INJ' },
  // Hedera — account ids are `0.0.N`, balance via the keyless public Mirror Node REST API (tinybar).
  hedera: { rpc: 'https://mainnet-public.mirrornode.hedera.com', type: 'hedera', decimals: 8, cgId: 'hedera-hashgraph', native: 'HBAR' },
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
  // Hyperliquid uses standard EVM 0x+40hex addresses.
  if (type === 'hyperliquid') return /^0x[a-fA-F0-9]{40}$/.test(address);
  // Sui addresses are 0x + 32 bytes (64 hex) — distinct length from EVM's 40, so unambiguous.
  if (type === 'sui') return /^0x[a-fA-F0-9]{64}$/.test(address);
  // Cardano Shelley bech32 payment addresses (addr1…). Loose min-length check, no checksum — a
  // malformed one simply fails upstream at Koios, matching the NEAR validator's looseness.
  if (type === 'cardano') return /^addr1[a-z0-9]{20,}$/.test(address);
  // Injective bech32 (inj1…).
  if (type === 'injective') return /^inj1[a-z0-9]{20,}$/.test(address);
  // Bittensor SS58 addresses start with 5 and are ~47–48 base58 chars.
  if (type === 'bittensor') return /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/.test(address);
  // Hedera account id: shard.realm.num, e.g. 0.0.12345.
  if (type === 'hedera') return /^\d{1,10}\.\d{1,10}\.\d{1,12}$/.test(address);
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

  if (cfg.type === 'hyperliquid') {
    // Spot HYPE balance from the L1 info API. `.total` is already a human-readable decimal string —
    // NOT raw base units — so it's parsed directly and never divided (cfg.decimals is 0 here).
    const res = (await rpc('https://api.hyperliquid.xyz/info', {
      type: 'spotClearinghouseState',
      user: address,
    })) as { balances?: { coin?: string; total?: string }[] };
    const hype = res?.balances?.find((b) => b.coin === 'HYPE');
    return { balance: parseFloat(hype?.total ?? '0') || 0 };
  }

  if (cfg.type === 'cardano') {
    const res = (await rpc(`${cfg.rpc}/address_info`, { _addresses: [address] })) as unknown as {
      balance?: string;
    }[];
    const lovelace = Array.isArray(res) ? res[0]?.balance : undefined;
    return { balance: fromUnits(BigInt(lovelace || '0'), cfg.decimals) };
  }

  if (cfg.type === 'sui') {
    const res = await rpc(cfg.rpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getBalance',
      params: [address, '0x2::sui::SUI'],
    });
    const mist = (res.result as { totalBalance?: string })?.totalBalance || '0';
    return { balance: fromUnits(BigInt(mist), cfg.decimals) };
  }

  if (cfg.type === 'injective') {
    const res = (await fetchJSON(
      `${cfg.rpc}/cosmos/bank/v1beta1/balances/${address}`,
    )) as { balances?: { denom?: string; amount?: string }[] };
    const inj = res?.balances?.find((b) => b.denom === 'inj');
    return { balance: fromUnits(BigInt(inj?.amount || '0'), cfg.decimals) };
  }

  if (cfg.type === 'hedera') {
    const res = (await fetchJSON(`${cfg.rpc}/api/v1/accounts/${address}`)) as {
      balance?: { balance?: number };
    };
    // Mirror Node returns the balance in tinybar as a JSON number; safe as a Number (< 2^53 for any
    // real HBAR holding) so it's divided directly rather than via BigInt.
    return { balance: (res?.balance?.balance ?? 0) / 10 ** cfg.decimals };
  }

  if (cfg.type === 'bittensor') {
    // Lazy import so no other chain's request loads @polkadot/api (a large dependency). getTaoBalance
    // degrades to 0 on any WS/connect failure, matching the empty-result fallback used elsewhere.
    const { getTaoBalance } = await import('./polkadot');
    return { balance: await getTaoBalance(address) };
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

/** Sort by USD value, sum the *whole* set before capping, then cap. Shared by every token source. */
function packTokens(tokens: TrackedToken[]) {
  tokens.sort((a, b) => b.usdValue - a.usdValue);
  const totalUsd = tokens.reduce((s, t) => s + t.usdValue, 0);
  const truncated = tokens.length > MAX_TOKENS;
  return { tokens: tokens.slice(0, MAX_TOKENS), totalUsd, truncated, totalCount: tokens.length };
}

// Moralis' free tier is 40k compute units/day. Every wallet-detail click on bsc/avalanche is one
// call, so re-opening the same card would burn quota needlessly. Cache each address' token result for
// a few minutes — a re-open inside the window costs 0 CU, which keeps normal browsing comfortably
// inside the free tier. Keyed by `chain:address`. Bounded so a long session can't grow it unboundedly.
const MORALIS_TTL_MS = 5 * 60_000;
const MORALIS_CACHE_MAX = 500;
type MoralisResult = Awaited<ReturnType<typeof fetchMoralisTokens>>;
const moralisCache = new Map<string, { at: number; data: MoralisResult }>();

/**
 * Token detail for EVM chains with no healthy Blockscout instance (bsc, avalanche), via Moralis'
 * free tier. Its /wallets/{addr}/tokens returns native + ERC-20 balances *and* USD prices in one
 * call. Returns null when MORALIS_API_KEY is unset, so the caller degrades to balance-only.
 * Cached (see moralisCache) so a repeat open of the same wallet doesn't spend a compute unit.
 */
async function getEvmTokensMoralis(address: string, chain: string, cfg: ChainCfg) {
  const key = process.env.MORALIS_API_KEY;
  const moralisChain = MORALIS_CHAINS[chain];
  if (!key || !moralisChain) return null;

  const cacheKey = `${chain}:${address.toLowerCase()}`;
  const hit = moralisCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MORALIS_TTL_MS) return hit.data;

  const data = await fetchMoralisTokens(address, moralisChain, key, cfg);

  // Evict the oldest entry once full (Map preserves insertion order) before recording the new one.
  if (moralisCache.size >= MORALIS_CACHE_MAX && !moralisCache.has(cacheKey)) {
    const oldest = moralisCache.keys().next().value;
    if (oldest) moralisCache.delete(oldest);
  }
  moralisCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function fetchMoralisTokens(address: string, moralisChain: string, key: string, cfg: ChainCfg) {
  // exclude_spam trims Moralis' airdrop noise upstream; limit caps the page (we only ship MAX_TOKENS).
  const res = await fetch(
    `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${moralisChain}&exclude_spam=true&limit=100`,
    {
      headers: { 'X-API-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(SLOW_TIMEOUT_MS),
      cache: 'no-store',
    },
  );
  const body = (await res.json()) as {
    result?: {
      symbol?: string;
      name?: string;
      balance_formatted?: string;
      usd_value?: number;
      usd_price?: number;
      native_token?: boolean;
      token_address?: string;
      logo?: string;
      possible_spam?: boolean;
      verified_contract?: boolean;
    }[];
    message?: string;
  };
  if (!res.ok) {
    // A handful of mega-whale wallets (e.g. Binance's BSC hot wallet) hold >10k tokens; Moralis
    // refuses to enumerate them on any endpoint. Surface that as its own state, not a generic error,
    // so the detail panel can say "too many tokens to list" instead of blanking.
    if (/too many|over 10000|10,000/i.test(body?.message ?? '')) {
      return { tokens: [], totalUsd: 0, tooMany: true };
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const tokens: TrackedToken[] = [];
  for (const t of body.result ?? []) {
    if (t.possible_spam) continue;
    // Spam tokens impersonate real symbols (a fake "USDT" with a 1e39 balance) and Moralis' spam flag
    // misses some, poisoning the total with absurd USD values. Every legit token here is a verified
    // contract; keep the native coin and verified ERC-20s only.
    if (!t.native_token && !t.verified_contract) continue;
    const bal = parseFloat(t.balance_formatted ?? '0') || 0;
    if (bal <= 0) continue;
    tokens.push({
      symbol: t.symbol || (t.native_token ? cfg.native : '???'),
      name: t.name || t.symbol || '???',
      balance: bal,
      usdValue: t.usd_value ?? 0,
      price: t.usd_price ?? 0,
      type: t.native_token ? 'native' : 'ERC-20',
      thumb: t.logo || '',
      contractAddress: t.native_token ? '' : t.token_address || '',
    });
  }
  return packTokens(tokens);
}

async function getTokens(address: string, chain: string) {
  const cfg = CHAINS[chain];
  if (!cfg) return { tokens: [], totalUsd: 0 };

  if (cfg.type === 'evm') {
    const host = BLOCKSCOUT_HOSTS[chain];
    if (!host) {
      // No Blockscout: try Moralis, and fall back to the priced native coin rather than an empty
      // list. An EVM chain with neither source used to return `{tokens: [], totalUsd: 0}` — a card
      // reading "$0.00 / no tokens" for a funded wallet, indistinguishable from a genuinely empty
      // one. Sonic is the case in point: keyless RPC + a CoinGecko id, but no token index anywhere.
      // Same honest degradation the non-EVM native-only chains already use (see below).
      return (
        (await getEvmTokensMoralis(address, chain, cfg)) ??
        (await getNativeOnlyTokens(address, chain, cfg))
      );
    }

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

    // A long-lived address accrues thousands of unpriced airdrop tokens (Vitalik's holds ~6.6k);
    // packTokens sorts by value and caps at MAX_TOKENS, summing the total *before* the cap.
    return packTokens(tokens);
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

  if (cfg.type === 'near') {
    return getNearTokens(address, chain, cfg);
  }

  // hyperliquid/cardano/sui/bittensor/injective: no keyless token index, so the detail view is the
  // priced native coin only. getBalance already knows how to read each of these.
  return getNativeOnlyTokens(address, chain, cfg);
}

/**
 * Detail view for a chain with no token-enumeration source: a single native-coin row, priced off
 * CoinGecko, which drives Total Value. Used by the five chains added beyond Reach's ten (hyperliquid,
 * cardano, sui, bittensor, injective) — each has a keyless native-balance lookup in getBalance but no
 * keyless multi-asset index to list held tokens.
 */
async function getNativeOnlyTokens(address: string, chain: string, cfg: ChainCfg) {
  const { balance } = await getBalance(address, chain);
  const prices = (await getPrices()) as Record<string, { usd?: number }>;
  const nativePrice = prices?.[cfg.cgId]?.usd ?? 0;
  const tokens: TrackedToken[] = [
    {
      symbol: cfg.native,
      name: cfg.native,
      balance,
      usdValue: balance * nativePrice,
      price: nativePrice,
      type: 'native',
      thumb: '',
      contractAddress: '',
    },
  ];
  return { tokens, totalUsd: balance * nativePrice };
}

/**
 * NEAR token detail: the native NEAR balance (priced off CoinGecko) plus any NEP-141 fungible tokens
 * the address holds. NEAR has no single "list an account's tokens" RPC, so the FT contract list comes
 * from FastNEAR's keyless index; each contract's symbol/decimals then come from its own ft_metadata
 * view call. Like Solana SPL / Tron TRC-20 here, NEP-141 tokens carry no USD price (no rate feed), so
 * they show a balance only — the native NEAR row is the priced one that drives Total Value.
 */
async function getNearTokens(address: string, chain: string, cfg: ChainCfg) {
  const { balance } = await getBalance(address, chain);
  const prices = (await getPrices()) as Record<string, { usd?: number }>;
  const nativePrice = prices?.[cfg.cgId]?.usd ?? 0;

  const tokens: TrackedToken[] = [
    {
      symbol: cfg.native,
      name: cfg.native,
      balance,
      usdValue: balance * nativePrice,
      price: nativePrice,
      type: 'native',
      thumb: '',
      contractAddress: '',
    },
  ];

  // FastNEAR's FT index — keyless. Degrade to native-only if it's down rather than failing the panel.
  let list: { contract_id?: string; balance?: string }[] = [];
  try {
    const res = (await fetchJSON(
      `https://api.fastnear.com/v1/account/${address}/ft`,
    )) as { tokens?: { contract_id?: string; balance?: string }[] };
    list = Array.isArray(res?.tokens) ? res.tokens : [];
  } catch {
    return packTokens(tokens);
  }

  // Cap the metadata fan-out: a spammy account can list hundreds of dust/airdrop contracts, and each
  // costs an ft_metadata RPC. Fetch metadata for at most NEAR_TOKEN_LIMIT non-zero balances.
  const holdings = list.filter((t) => t.contract_id && t.balance && t.balance !== '0');
  const metas = await Promise.all(
    holdings.slice(0, NEAR_TOKEN_LIMIT).map((t) => nearFtMeta(cfg.rpc, t.contract_id as string)),
  );

  holdings.slice(0, NEAR_TOKEN_LIMIT).forEach((t, i) => {
    const meta = metas[i];
    if (!meta) return;
    // FastNEAR balances are integer strings; guard the BigInt cast so one malformed entry skips its
    // row instead of throwing out of the whole NEAR detail fetch.
    let bal: number;
    try {
      bal = fromUnits(BigInt(t.balance as string), meta.decimals);
    } catch {
      return;
    }
    if (bal <= 0) return;
    tokens.push({
      symbol: meta.symbol,
      name: meta.name || meta.symbol,
      balance: bal,
      usdValue: 0,
      price: 0,
      type: 'NEP-141',
      thumb: meta.icon,
      contractAddress: t.contract_id as string,
    });
  });

  return packTokens(tokens);
}

/** Most NEP-141 contracts to resolve metadata for per wallet — keeps the ft_metadata fan-out bounded. */
const NEAR_TOKEN_LIMIT = 50;

/** Read a NEP-141 contract's ft_metadata (symbol/name/decimals/icon) via a view call. null on error. */
async function nearFtMeta(
  rpcUrl: string,
  contractId: string,
): Promise<{ symbol: string; name: string; decimals: number; icon: string } | null> {
  try {
    const res = await rpc(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: 'ft_metadata',
        args_base64: 'e30=', // "{}"
      },
    });
    // The contract's return value arrives as a byte array of the JSON-encoded metadata.
    const bytes = (res.result as { result?: number[] })?.result;
    return parseFtMetadata(bytes, contractId);
  } catch {
    return null;
  }
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
