import { NextResponse } from 'next/server';
import { buildAndSaveReport } from '../_lib/build';
import { checkCronAuth } from '../_lib/cronAuth';
import type { Period } from '../_lib/types';

// The scheduled report generator — Vercel cron, `0 18 * * *` (see web/vercel.json).
//
// ── Why 18:00 UTC ──
// 1 PM Cancún. America/Cancun is UTC-5 **year-round**: Quintana Roo dropped DST in 2015, so unlike
// every other US/Mexico timezone this needs no DST branch anywhere — the cron expression alone is
// correct in January and July. Vercel crons run in UTC and Hobby only guarantees the hour, not the
// minute, so the report lands "around 1 PM" rather than on the dot. Crypto trades 24/7; the window
// boundary is a reporting convention, not a market event.
//
// ── Date routing ──
// One cron, three report types, because Vercel Hobby allows only 2 cron entries total and
// /api/keep-alive is the other. Daily runs every day; weekly additionally on Mondays; monthly
// additionally on the 1st. On a Monday-the-1st all three run.
//
// ── Idempotency ──
// Vercel does NOT guarantee at-most-once cron delivery — a timed-out or failed invocation may be
// retried. Every write upserts on (period, report_date), so a retry refreshes the day's row instead
// of posting a duplicate report.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The weekly/monthly Binance klines pass measures ~5s and the LLM call sits on top; ask for the
// full Hobby budget rather than discover the default mid-generation.
export const maxDuration = 60;

export async function GET(request: Request) {
  // Vercel injects `Authorization: Bearer $CRON_SECRET`. Enforced when configured so the route
  // isn't an open "burn my LLM quota" button for anyone who finds the URL; open when unset rather
  // than hard-failing a deploy that lacks the env var. See cronAuth.ts for why an unsendable
  // secret is its own state rather than a misleading 401.
  const auth = checkCronAuth(request.headers, process.env.CRON_SECRET);
  if (auth === 'misconfigured') {
    // Deliberately loud and distinct from 401: the secret isn't wrong, it's untransmittable (a
    // non-latin-1 character — a pasted em-dash or curly quote). Nobody could ever authenticate,
    // and reporting "unauthorized" would send the operator hunting the wrong bug entirely.
    console.error(
      '[reports/cron] CRON_SECRET contains a character that cannot be sent in an HTTP header ' +
        '(non-latin-1, e.g. an em-dash or curly quote from a copy-paste). No caller can ever ' +
        'authenticate. Replace it with an ASCII value, e.g. `openssl rand -hex 32`.',
    );
    return NextResponse.json({ ok: false, error: 'cron secret misconfigured' }, { status: 500 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const periods: Period[] = ['daily'];
  if (now.getUTCDay() === 1) periods.push('weekly');
  if (now.getUTCDate() === 1) periods.push('monthly');

  // Sequential, not Promise.all: on a Monday-the-1st all three run, and each weekly/monthly pass
  // fires ~174 concurrent-batched Binance calls. Running them in series keeps peak upstream
  // pressure to one period's batch and keeps us clear of rate limits.
  const results: { period: Period; ok: boolean; coins?: number; saved?: boolean; error?: string }[] = [];
  for (const period of periods) {
    try {
      const { report, saved } = await buildAndSaveReport(period, now);
      results.push({ period, ok: true, coins: report.coins.length, saved });
    } catch (e) {
      // One period failing must not abort the others — a broken weekly shouldn't cost the daily.
      // The message is ours (never an upstream body), so nothing internal leaks to a public URL.
      results.push({ period, ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, date: now.toISOString().slice(0, 10), results }, { status: ok ? 200 : 500 });
}
