import { NextResponse } from 'next/server';
import { canRead, selectRows } from '../_lib/supabase';

// One report plus its wall — comments and reaction tallies, fetched together so opening a card is
// one round trip rather than three.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!canRead()) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  // Validate before it reaches a PostgREST filter — an id from the URL is caller input.
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  try {
    const [rows, comments, reactions] = await Promise.all([
      selectRows<Row>(
        'reports',
        `select=id,period,report_date,coins,binance_pairs,sentiment,analysis,llm_provider,created_at` +
          `&id=eq.${params.id}&limit=1`,
      ),
      selectRows<{ id: string; nickname: string; body: string; created_at: string }>(
        'report_comments',
        `select=id,nickname,body,created_at&report_id=eq.${params.id}&order=created_at.asc&limit=200`,
      ).catch(() => []),
      selectRows<{ emoji: string; count: number }>(
        'report_reactions',
        `select=emoji,count&report_id=eq.${params.id}`,
      ).catch(() => []),
    ]);

    const r = rows[0];
    if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      report: {
        id: r.id,
        period: r.period,
        reportDate: r.report_date,
        coins: r.coins ?? [],
        binancePairs: r.binance_pairs ?? [],
        sentiment: r.sentiment ?? {},
        analysis: r.analysis ?? null,
        llmProvider: r.llm_provider,
        generatedAt: new Date(r.created_at).getTime(),
      },
      comments,
      reactions,
    });
  } catch {
    return NextResponse.json({ error: 'Could not load report' }, { status: 502 });
  }
}
