import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

// TEMPORARY diagnostic — reports the sha256 PREFIX + length of the runtime env keys so we can tell
// which key production actually holds, without ever exposing a value. DELETE after use.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fp(v: string | undefined) {
  const s = v ?? '';
  return {
    len: s.length,
    sha8: s ? createHash('sha256').update(s).digest('hex').slice(0, 8) : null,
    prefix: s.slice(0, 3),
  };
}

export async function GET() {
  return NextResponse.json({
    service: fp(process.env.SUPABASE_SERVICE_ROLE_KEY),
    anon: fp(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    url_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    url_host: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/^https?:\/\//, '').split('.')[0],
  });
}
