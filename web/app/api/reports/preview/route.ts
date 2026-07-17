import { NextResponse } from 'next/server';
import { buildReport } from '../_lib/build';
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

const cache = new Map<Period, { at: number; report: Report }>();

/* Single-flight, same reasoning as app/api/market/cmc/route.ts: concurrent misses for the same
 * period share one pass instead of each triggering their own upstream sweep and LLM call. Cleared
 * in `finally` so a failed pass never wedges the key. Per-instance, so it collapses the herd within
 * one server, not across serverless instances — a cost reduction, not a global lock. */
const inflight = new Map<Period, Promise<Report>>();

async function getReport(period: Period): Promise<Report> {
  const report = await buildReport(period);
  // Don't cache a total wipeout — a transient upstream blip would otherwise stick for three hours.
  // A report with no coins is exactly the case worth retrying on the next request.
  if (report.coins.length > 0 || report.binancePairs.length > 0) {
    cache.set(period, { at: Date.now(), report });
  }
  return report;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('period');
  const period: Period = isPeriod(raw) ? raw : 'daily';

  const hit = cache.get(period);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.report);
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
