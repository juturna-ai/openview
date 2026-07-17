import { NextResponse } from 'next/server';
import { allow, clientIp, retryAfter } from '../_lib/rateLimit';
import { canWrite, insertRow } from '../_lib/supabase';

// POST {reportId, nickname, body} — add a comment to a report's wall.
//
// The browser never writes to Supabase: the tables have public SELECT and no write policy, so the
// anon key that ships to the client can't insert here even if someone lifts it out of DevTools.
// This route holds the service_role key and is the only door in — which is exactly why it validates
// everything and rate-limits before touching the DB.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;
const LIMIT = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NICK_MAX = 32;
const BODY_MAX = 500;

export async function POST(req: Request) {
  if (!canWrite()) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  const ip = clientIp(req);
  if (!allow(`comment:${ip}`, LIMIT, WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many comments — try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter(`comment:${ip}`)) } },
    );
  }

  // `?? {}` because a body of literal `null` is valid JSON — req.json() resolves rather than throws,
  // so the catch never fires and the field access below would throw an uncaught TypeError, turning
  // a 400 into an opaque 500.
  let payload: { reportId?: unknown; nickname?: unknown; body?: unknown };
  try {
    payload = ((await req.json()) as Record<string, unknown> | null) ?? {};
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (typeof payload !== 'object') payload = {};

  const reportId = typeof payload.reportId === 'string' ? payload.reportId : '';
  // Mirrors the DB's CHECK constraints. Validating here too isn't redundant: it turns an opaque
  // PostgREST 400 into a message the UI can actually show, and keeps junk off the wire.
  const nickname = (typeof payload.nickname === 'string' ? payload.nickname : '').trim().slice(0, NICK_MAX);
  const body = (typeof payload.body === 'string' ? payload.body : '').trim().slice(0, BODY_MAX);

  if (!UUID_RE.test(reportId)) return NextResponse.json({ error: 'Bad report id' }, { status: 400 });
  if (!nickname) return NextResponse.json({ error: 'Pick a nickname first' }, { status: 400 });
  if (!body) return NextResponse.json({ error: 'Say something first' }, { status: 400 });

  try {
    // The FK to reports(id) rejects a comment on a report that doesn't exist — no need to
    // pre-check, and no TOCTOU gap.
    await insertRow('report_comments', { report_id: reportId, nickname, body });
    return NextResponse.json({ ok: true });
  } catch {
    // Never echo the upstream body — it can carry schema/role detail.
    return NextResponse.json({ error: 'Could not post comment' }, { status: 502 });
  }
}
