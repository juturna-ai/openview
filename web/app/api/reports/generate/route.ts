import { NextResponse } from 'next/server';
import { buildAndSaveReport } from '../_lib/build';
import { checkCronAuth } from '../_lib/cronAuth';
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
// ── Auth: same secret as the cron ──
// This route triggers the single most expensive operation in the app — a 500-coin CMC listing, a
// 1.9 MB Binance ticker, up to ~174 klines calls and an LLM round-trip, ~25s of work. It shipped
// unauthenticated at first, which made it a public "burn my Gemini quota and hammer CMC from your
// own IP" button for anyone who guessed a predictable Next.js route path. The in-memory throttle
// below is NOT a substitute: it's per-lambda-instance, so a burst of concurrent requests landing on
// cold instances each get their own fresh budget. Same pipeline, same cost ⇒ same credential as
// /api/reports/cron.
//
// The throttle stays as a second layer: it's keyed globally per period (not per IP), because the
// cost is borne by shared upstream quotas, not by the caller.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 5 * 60_000;
const LIMIT = 1;

export async function POST(req: Request) {
  const auth = checkCronAuth(req.headers, process.env.CRON_SECRET);
  if (auth === 'misconfigured') {
    console.error(
      '[reports/generate] CRON_SECRET contains a character that cannot be sent in an HTTP header ' +
        '(non-latin-1). No caller can authenticate. Use an ASCII value, e.g. `openssl rand -hex 32`.',
    );
    return NextResponse.json({ ok: false, error: 'cron secret misconfigured' }, { status: 500 });
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // `?? {}` because a body of literal `null` is valid JSON: req.json() resolves rather than throws,
  // so the catch below never fires and the field access would throw an uncaught TypeError — an
  // opaque 500 where a 400 belongs.
  let payload: { period?: unknown };
  try {
    payload = ((await req.json()) as { period?: unknown } | null) ?? {};
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (typeof payload !== 'object') payload = {};

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
