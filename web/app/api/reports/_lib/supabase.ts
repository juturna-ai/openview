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

/**
 * The only tables and functions this module may touch.
 *
 * This is not theatre. The service_role key bypasses RLS **entirely**, and this database is shared
 * with the mobile app: `push_tokens`, `sync_state` and `push_alerts` hold real user data whose
 * own `auth.uid() = user_id` policies are no defence against this key. Today every call site passes
 * a hardcoded literal, so nothing can reach them — but that safety lives in the callers' discipline,
 * not in this module. One future route threading a request param into `table` would be a
 * cross-tenant write with no other guardrail. The cost of the allow-list is a thrown error on a
 * typo; the cost of omitting it is someone's push tokens.
 */
const ALLOWED_TABLES = new Set(['reports', 'report_comments', 'report_reactions']);
const ALLOWED_FUNCTIONS = new Set(['increment_reaction', 'decrement_reaction']);

/** Throws rather than returns: a disallowed target is always a programming error, never input. */
function assertTable(table: string) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`refusing to touch table "${table}" — not in the Reports allow-list`);
  }
}

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
  assertTable(table);
  const res = await call(`${table}?${query}`, { method: 'GET', key: anonKey() });
  if (!res.ok) throw new Error(`select ${table}: HTTP ${res.status}`);
  const rows = (await res.json()) as T[];
  return Array.isArray(rows) ? rows : [];
}

/** INSERT with the service-role key. */
export async function insertRow(table: string, row: unknown): Promise<void> {
  assertTable(table);
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
  assertTable(table);
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
  if (!ALLOWED_FUNCTIONS.has(fn)) {
    throw new Error(`refusing to call function "${fn}" — not in the Reports allow-list`);
  }
  const res = await call(`rpc/${fn}`, {
    method: 'POST',
    key: serviceKey(),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn}: HTTP ${res.status}`);
  return res.json().catch(() => null);
}
