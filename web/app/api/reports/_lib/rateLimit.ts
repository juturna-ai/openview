// Per-IP token buckets for the anonymous write routes.
//
// ── What this is and isn't ──
//
// This is spam FRICTION, not a security boundary. Two honest limitations:
//
//   1. It's module state, so it's per-lambda-instance. Vercel runs several instances under load,
//      each with its own empty bucket, so the effective limit is N x (warm instances), not a hard
//      global N. Making it global needs a shared store (Upstash/Redis) — deliberately not worth a
//      dependency for a low-traffic wall.
//   2. An IP is not a person. Shared NAT lumps strangers together; a determined abuser rotates.
//
// It's acceptable precisely because it isn't load-bearing: the tables have NO public write policy,
// so the only way in is through these routes, which validate everything. Getting past the limiter
// buys you extra rows, not access.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Keep the Map from growing without bound on a long-lived instance. */
const MAX_KEYS = 5000;

/**
 * The caller's IP. Vercel sets x-forwarded-for; the first entry is the client, the rest are
 * proxies. Falls back to a constant so a missing header degrades to one shared bucket (stricter)
 * rather than to no limit at all.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Consume one token. Returns false when the caller is over budget.
 *
 * @param key    bucket identity — scope it per action (`comment:1.2.3.4`), so a chatty reactor
 *               doesn't spend the commenter's budget.
 * @param limit  allowed hits per window
 * @param windowMs  window length
 */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now >= b.resetAt) {
    if (buckets.size >= MAX_KEYS) {
      // Drop expired entries first; only if that frees nothing do we clear wholesale (which briefly
      // forgives everyone — acceptable, and far better than unbounded memory).
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

/** Seconds until the caller's window resets — for a Retry-After header. */
export function retryAfter(key: string): number {
  const b = buckets.get(key);
  if (!b) return 0;
  return Math.max(1, Math.ceil((b.resetAt - Date.now()) / 1000));
}
