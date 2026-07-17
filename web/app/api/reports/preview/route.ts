import { NextResponse } from 'next/server';
import { buildReport } from '../_lib/build';
import { allow, clientIp, retryAfter } from '../_lib/rateLimit';
import { isPeriod, type Period, type Report } from '../_lib/types';

// Live report builder — computes a report on demand and returns it, with no database involved.
//
// This is Phase 1 of the Reports feature: the Daily/Weekly/Monthly tabs are fully functional off
// this route before the Supabase project exists. Once it does, the cron persists reports on a
// schedule and the tabs read stored history instead; this route stays as the manual/preview path.
//
// Caching matters more here than on the market routes. A miss costs a 500-coin CMC listing, a
// 1.9 MB Binance ticker, up to ~200 klines calls, and an LLM round-trip — so the TTL is hours, not
// seconds. Reports describe a 24h/7d/30d window; they do not meaningfully change minute to minute.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The weekly/monthly klines pass measured ~5s, but Vercel's Hobby ceiling is 60s and an LLM call
// sits on top of it — ask for the full budget rather than discover the default mid-generation.
export const maxDuration = 60;

const CACHE_TTL_MS = 3 * 60 * 60_000;

/** A build that produced nothing is cached only briefly, so the next request retries soon —
 *  but NOT not-at-all. Never caching an empty result meant a transient upstream failure (or an
 *  induced one) left the period permanently uncached, and every subsequent request re-ran a full
 *  CMC + Binance + LLM pass. That turned a bad upstream minute into an unbounded cost amplifier. */
const EMPTY_TTL_MS = 60_000;

/** Backstop against someone hammering the route to force repeated full builds. The cache and
 *  single-flight already collapse the common case, but both are per-instance, and an empty build
 *  used to bypass the cache entirely — so a hard ceiling is worth having. Generous enough that no
 *  real user ever meets it (a normal visit is 1-2 requests, and hits are served from cache). */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const cache = new Map<Period, { at: number; report: Report }>();
/** Marks periods whose last build came back empty, so the shorter TTL applies to them. */
const emptyAt = new Map<Period, number>();

/* Single-flight, same reasoning as app/api/market/cmc/route.ts: concurrent misses for the same
 * period share one pass instead of each triggering their own upstream sweep and LLM call. Cleared
 * in `finally` so a failed pass never wedges the key. Per-instance, so it collapses the herd within
 * one server, not across serverless instances — a cost reduction, not a global lock. */
const inflight = new Map<Period, Promise<Report>>();

async function getReport(period: Period): Promise<Report> {
  const report = await buildReport(period);
  const empty = report.coins.length === 0 && report.binancePairs.length === 0;
  // Cache either way — but an empty result expires in a minute rather than three hours, so a
  // transient upstream blip is retried promptly without leaving the route unprotected in between.
  cache.set(period, { at: Date.now(), report });
  if (empty) emptyAt.set(period, Date.now());
  else emptyAt.delete(period);
  return report;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('period');
  const period: Period = isPeriod(raw) ? raw : 'daily';

  const hit = cache.get(period);
  const ttl = emptyAt.has(period) ? EMPTY_TTL_MS : CACHE_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) {
    return NextResponse.json(hit.report);
  }

  // Only misses reach the limiter — a cache hit is nearly free and must never be throttled.
  const ip = clientIp(req);
  if (!allow(`preview:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter(`preview:${ip}`)) } },
    );
  }

  let job = inflight.get(period);
  if (!job) {
    job = getReport(period).finally(() => inflight.delete(period));
    inflight.set(period, job);
  }

  try {
    return NextResponse.json(await job);
  } catch {
    // Never leak an upstream error message or stack to the client (CLAUDE.md security rule).
    return NextResponse.json({ error: 'Report generation failed' }, { status: 502 });
  }
}
