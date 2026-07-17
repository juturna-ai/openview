import { NextResponse } from 'next/server';
import { canRead, selectRows } from '../_lib/supabase';
import { isPeriod } from '../_lib/types';

// The feed. GET ?period=daily|weekly|monthly&limit=n
//
// Anon-key read: these rows are public by design (RLS grants SELECT to everyone), so there's
// nothing to hide behind the server — the proxy exists to keep the query shape and the PostgREST
// URL out of the client, and to normalise snake_case into the app's camelCase shape.
//
// Omitting `period` returns all periods interleaved by recency — that's the Dashboard's feed.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 50;

interface Row {
  id: string;
  period: string;
  report_date: string;
  coins: unknown;
  binance_pairs: unknown;
  sentiment: unknown;
  analysis: unknown;
  llm_provider: string | null;
  created_at: string;
}

/** DB row → the shape the client already renders (see PeriodView's Report interface).
 *  Not exported: a route file may only export handlers and route config. */
const toReport = (r: Row) => ({
  id: r.id,
  period: r.period,
  reportDate: r.report_date,
  coins: r.coins ?? [],
  binancePairs: r.binance_pairs ?? [],
  sentiment: r.sentiment ?? {},
  analysis: r.analysis ?? null,
  llmProvider: r.llm_provider,
  generatedAt: new Date(r.created_at).getTime(),
});

export async function GET(req: Request) {
  // Not configured yet (Phase 1 deploy, or env vars missing): an empty feed is the honest answer.
  // The client falls back to /api/reports/preview, so the tabs keep working.
  if (!canRead()) return NextResponse.json({ reports: [], configured: false });

  const sp = new URL(req.url).searchParams;
  const rawPeriod = sp.get('period');
  const rawLimit = Number(sp.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 20;

  // Only a known period ever reaches the query string — never interpolate caller input into a
  // PostgREST filter unchecked.
  const filter = isPeriod(rawPeriod) ? `&period=eq.${rawPeriod}` : '';

  try {
    const rows = await selectRows<Row>(
      'reports',
      `select=id,period,report_date,coins,binance_pairs,sentiment,analysis,llm_provider,created_at` +
        `${filter}&order=report_date.desc,created_at.desc&limit=${limit}`,
    );
    return NextResponse.json({ reports: rows.map(toReport), configured: true });
  } catch {
    return NextResponse.json({ error: 'Could not load reports' }, { status: 502 });
  }
}
