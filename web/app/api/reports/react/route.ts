import { NextResponse } from 'next/server';
import { allow, clientIp, retryAfter } from '../_lib/rateLimit';
import { canWrite, rpc } from '../_lib/supabase';

// POST {reportId, emoji, op?} — bump (op 'add', the default) or un-bump (op 'remove') a reaction
// tally. Toggling is per-browser courtesy, not identity: the client only sends 'remove' for a
// reaction it stored locally, and the SQL floors at zero, so a hostile client can at worst zero a
// public counter it could equally have inflated.
//
// Reactions are cheaper to spam and cheaper to get wrong than comments, so the limit is looser but
// the input is tighter: only the four emoji the UI actually renders are accepted. An allow-list
// (rather than "any short string") keeps the tally deterministic and means no one can seed the
// table with arbitrary text through a field the UI never exposes.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;
const LIMIT = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Must stay in sync with REACTIONS in app/home/reports/DashboardView.tsx. */
const ALLOWED = new Set(['🚀', '📈', '👀', '🤔']);

export async function POST(req: Request) {
  if (!canWrite()) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  const ip = clientIp(req);
  if (!allow(`react:${ip}`, LIMIT, WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Slow down a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter(`react:${ip}`)) } },
    );
  }

  // `?? {}` because a body of literal `null` is valid JSON — req.json() resolves rather than throws,
  // so the catch never fires and the field access below would throw an uncaught TypeError, turning
  // a 400 into an opaque 500.
  let payload: { reportId?: unknown; emoji?: unknown; op?: unknown };
  try {
    payload = ((await req.json()) as Record<string, unknown> | null) ?? {};
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (typeof payload !== 'object') payload = {};

  const reportId = typeof payload.reportId === 'string' ? payload.reportId : '';
  const emoji = typeof payload.emoji === 'string' ? payload.emoji : '';
  const op = payload.op === undefined || payload.op === 'add' ? 'add'
    : payload.op === 'remove' ? 'remove' : '';

  if (!UUID_RE.test(reportId)) return NextResponse.json({ error: 'Bad report id' }, { status: 400 });
  if (!ALLOWED.has(emoji)) return NextResponse.json({ error: 'Unknown reaction' }, { status: 400 });
  if (!op) return NextResponse.json({ error: 'Unknown op' }, { status: 400 });

  try {
    // Both functions do their upsert/update atomically in Postgres. A read-then-write here would
    // drop concurrent clicks (lost update) — two people reacting at once would count as one.
    const fn = op === 'add' ? 'increment_reaction' : 'decrement_reaction';
    const count = await rpc(fn, { p_report_id: reportId, p_emoji: emoji });
    return NextResponse.json({ ok: true, count });
  } catch {
    return NextResponse.json({ error: 'Could not react' }, { status: 502 });
  }
}
