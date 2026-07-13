import { NextResponse } from 'next/server';

// Supabase pauses a free-tier project after 7 days with no database activity. A Vercel cron
// (see web/vercel.json) hits this route once a day and performs a REAL read against the
// `keep_alive` table, which counts as activity and resets that 7-day timer. A route that
// merely returned {ok:true} would keep the cron green while the database still got paused.
//
// Anon key only — this is the same public key the browser already ships with, and the
// `keep_alive_select_anon` RLS policy grants it SELECT on this one table. The service_role
// key must never appear here.

// The read must hit the database on every invocation; caching it would defeat the purpose.
export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET(request: Request) {
  // Vercel injects `Authorization: Bearer $CRON_SECRET` when it triggers a cron. When the
  // secret is configured we require it, so the route can't be used as an open DB-ping by
  // anyone who finds the URL. When it isn't set, the route stays open (the cron still works)
  // rather than hard-failing a deploy that hasn't had the env var added yet.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json(
      { ok: false, error: 'supabase env vars missing' },
      { status: 500 },
    );
  }

  try {
    // PostgREST read — the exact request @supabase/supabase-js would issue for
    // .from('keep_alive').select('note').limit(1), without pulling in the client dependency.
    const res = await fetch(`${url}/rest/v1/keep_alive?select=note&limit=1`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      // Deliberately does not echo the Supabase response body — it can carry internal
      // schema/role detail we don't want on a public endpoint.
      return NextResponse.json(
        { ok: false, error: 'supabase read failed', status: res.status },
        { status: 500 },
      );
    }

    const rows = (await res.json()) as Array<{ note: string }>;

    // A 200 with zero rows means the row was deleted or RLS stopped returning it. The DB was
    // still touched, but the table is no longer a valid ping target, so surface it loudly
    // instead of reporting success.
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'keep_alive table returned no rows' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, rows: rows.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'supabase unreachable' }, { status: 500 });
  }
}
