// Bittensor (TAO) balance lookup over Substrate WebSocket JSON-RPC.
//
// Unlike every other chain in the tracker, Bittensor has no keyless HTTP balance endpoint in 2026:
// Taostats and Subscan both require an API key, and the only free public node
// (wss://entrypoint-finney.opentensor.ai:443) speaks Substrate's WebSocket JSON-RPC. Reading
// `system.account` off it means SCALE-decoding storage, which is what @polkadot/api exists to do —
// hence the tracker's first real npm dependency, isolated in this module so no other chain's request
// pays its (large) parse/init cost. route.ts only ever `await import('./polkadot')` inside the
// bittensor branch.
//
// The ApiPromise is a singleton: one WS connection is opened lazily and reused across requests, since
// reconnecting per lookup would be slow and hammer the public node. On serverless the module may cold
// start, re-opening the socket once per fresh instance — acceptable, and far better than per-call.

import type { ApiPromise as ApiPromiseType } from '@polkadot/api';

/** rao → TAO. Bittensor uses 9 decimals, like Solana. */
const TAO_DECIMALS = 9;

// One shared connect promise. Assigned synchronously before its first await so two near-simultaneous
// callers on a fresh instance can't both start a connect (they share this one promise).
let apiPromise: Promise<ApiPromiseType> | null = null;

async function connect(): Promise<ApiPromiseType> {
  // Imported here, not at module top, so merely loading this module (already lazy) is cheap until a
  // bittensor lookup actually needs the client.
  const { ApiPromise, WsProvider } = await import('@polkadot/api');
  const provider = new WsProvider('wss://entrypoint-finney.opentensor.ai:443');
  // If the socket drops, clear the singleton so the next lookup reconnects rather than reusing a dead
  // client. WsProvider auto-reconnects internally too, but this guards the case where connect itself
  // races a disconnect.
  provider.on('disconnected', () => {
    apiPromise = null;
  });
  return ApiPromise.create({ provider });
}

function getApi(): Promise<ApiPromiseType> {
  if (!apiPromise) {
    apiPromise = connect().catch((e) => {
      // Don't cache a failed connect — next call retries.
      apiPromise = null;
      throw e;
    });
  }
  return apiPromise;
}

/**
 * Free TAO balance for an SS58 address, or 0 on any failure (dead socket, cold-start timeout, bad
 * address). The caller degrades a failed lookup to a $0.00 card rather than an error, matching every
 * other chain here. A hard timeout keeps one hung WS call from holding a refresh-pool slot open.
 */
export async function getTaoBalance(address: string): Promise<number> {
  const CONNECT_TIMEOUT_MS = 8_000;
  try {
    const api = await Promise.race([
      getApi(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('bittensor connect timeout')), CONNECT_TIMEOUT_MS),
      ),
    ]);
    const account = await api.query.system.account(address);
    // account.data.free is a Balance (u128) in rao.
    const free = (account as unknown as { data: { free: { toString(): string } } }).data.free;
    return Number(BigInt(free.toString())) / 10 ** TAO_DECIMALS;
  } catch {
    return 0;
  }
}
