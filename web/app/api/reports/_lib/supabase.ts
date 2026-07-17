// Minimal PostgREST client for the Reports tables.
//
// Raw `fetch` rather than @supabase/supabase-js, matching what app/api/keep-alive/route.ts already
// does: these are the exact requests the client library would issue, without adding the dependency
// (and its bundle) to a deliberately lean app. If this grows past a handful of calls, revisit.
//
// ── The key rule ──
// `anon` for reads, `service_role` for writes, never the reverse. The anon key is public (it ships
// to the browser already); the service_role key bypasses RLS entirely and must never leave the
// server or appear in anything NEXT_PUBLIC_*. Every write here is called only from a route that has
// already validated and rate-limited its input.

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** True when reads are possible. Routes degrade to the live builder instead of failing. */
export const canRead = (): boolean => Boolean(url() && anonKey());
/** True when writes are possible (cron/comment/react). */
export const canWrite = (): boolean => Boolean(url() && serviceKey());

const TIMEOUT_MS = 10_000;

async function call(
  path: string,
  init: RequestInit & { key: string },
): Promise<Response> {
  const { key, ...rest } = init;
  return fetch(`${url()}/rest/v1/${path}`, {
    ...rest,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
}

/** SELECT with the anon key. `query` is a PostgREST query string, e.g. `select=*&limit=1`. */
export async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const res = await call(`${table}?${query}`, { method: 'GET', key: anonKey() });
  if (!res.ok) throw new Error(`select ${table}: HTTP ${res.status}`);
  const rows = (await res.json()) as T[];
  return Array.isArray(rows) ? rows : [];
}

/** INSERT with the service-role key. */
export async function insertRow(table: string, row: unknown): Promise<void> {
  const res = await call(table, {
    method: 'POST',
    key: serviceKey(),
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert ${table}: HTTP ${res.status}`);
}

/**
 * UPSERT with the service-role key, resolving on `onConflict`'s unique constraint.
 *
 * This is what makes the cron idempotent: Vercel may retry a failed or timed-out invocation, and a
 * plain insert would post a second report for the same day. Merging on (period, report_date) means
 * a retry — or a manual re-generate — refreshes the existing row instead.
 */
export async function upsertRow(table: string, row: unknown, onConflict: string): Promise<void> {
  const res = await call(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    key: serviceKey(),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`upsert ${table}: HTTP ${res.status}`);
}

/** Call a Postgres function with the service-role key (used for the atomic reaction increment). */
export async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await call(`rpc/${fn}`, {
    method: 'POST',
    key: serviceKey(),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status}`);
  return res.json().catch(() => null);
}
