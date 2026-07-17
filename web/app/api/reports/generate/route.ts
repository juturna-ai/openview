import { NextResponse } from 'next/server';
import { buildAndSaveReport } from '../_lib/build';
import { allow, retryAfter } from '../_lib/rateLimit';
import { isPeriod, type Period } from '../_lib/types';

// POST {period} — build and save a report on demand, without waiting for 18:00 UTC.
//
// Exists so a report can be produced and tested right now (and re-pulled if a generation caught a
// bad upstream moment). Uses the same buildAndSaveReport as the cron — one code path, so testing
// this tests the scheduled behaviour too. Upserting on (period, report_date) means running it twice
// refreshes the day's report rather than duplicating it, and it can't collide with the cron:
// whichever runs last wins, which is the correct semantic for a manual refresh.
//
// ── Why it's throttled globally, not per-IP ──
// Each call costs a 500-coin CMC listing, a 1.9 MB Binance sweep, up to ~174 klines calls and an
// LLM round-trip. A per-IP limit would still let a handful of visitors drain the Gemini free tier
// between them. This is a maintenance action with one legitimate user, so the budget is global.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 5 * 60_000;
const LIMIT = 1;

export async function POST(req: Request) {
  let payload: { period?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const period: Period = isPeriod(payload.period) ? payload.period : 'daily';

  // Keyed per period so refreshing the daily doesn't lock out the weekly.
  const key = `generate:${period}`;
  if (!allow(key, LIMIT, WINDOW_MS)) {
    return NextResponse.json(
      { error: `A ${period} report was just generated — try again in a few minutes.` },
      { status: 429, headers: { 'Retry-After': String(retryAfter(key)) } },
    );
  }

  try {
    const { report, saved } = await buildAndSaveReport(period);
    return NextResponse.json({
      ok: true,
      saved,
      period: report.period,
      reportDate: report.reportDate,
      coins: report.coins.length,
      binancePairs: report.binancePairs.length,
      analysis: report.analysis ? report.llmProvider : null,
    });
  } catch {
    return NextResponse.json({ error: 'Report generation failed' }, { status: 502 });
  }
}
