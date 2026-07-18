// Tests for the PostgREST client's table/function allow-list (see supabase.ts).
//
// WHY THIS EXISTS — the blast radius, stated plainly:
//
//   This database is SHARED with the OpenView mobile app. `push_tokens`, `sync_state` and
//   `push_alerts` hold real user data, protected by `auth.uid() = user_id` RLS policies. The
//   service_role key this module holds for writes **bypasses RLS entirely** — those policies are
//   no defence against it.
//
//   Every call site currently passes a hardcoded table literal, so nothing can reach the mobile
//   tables today. But that safety lived in the callers' discipline, not in the module: one future
//   route threading a request param into `table` would be a cross-tenant write against someone's
//   push tokens, with nothing else in the stack to stop it. The allow-list turns that class of
//   mistake from a silent data breach into a thrown error at the boundary.
//
//   These tests pin that guarantee so it can't be quietly removed.
//
// Run: node web/app/api/reports/_lib/supabaseGuard.logic.test.mjs

import assert from 'node:assert/strict';

// The module reads env lazily inside the functions, so importing it without Supabase configured is
// safe — the allow-list is checked BEFORE any network call, which is the property under test.
const { selectRows, insertRow, upsertRow, rpc } = await import('./supabase.ts');

/** The guard must reject before any fetch happens, so no env/network is needed. */
async function rejects(fn, why) {
  await assert.rejects(fn, /not in the Reports allow-list/, why);
}

/* ── 1. The mobile app's tables are unreachable through every entry point ── */
{
  for (const table of ['push_tokens', 'sync_state', 'push_alerts', 'keep_alive']) {
    await rejects(() => selectRows(table, 'select=*'), `selectRows must refuse ${table}`);
    await rejects(() => insertRow(table, {}), `insertRow must refuse ${table}`);
    await rejects(() => upsertRow(table, {}, 'id'), `upsertRow must refuse ${table}`);
  }
  // keep_alive is deliberately NOT allow-listed here: /api/keep-alive owns it with the anon key and
  // does not go through this module. Reports has no business writing to it.
}

/* ── 2. Postgres internals and auth tables are unreachable ── */
{
  for (const table of ['users', 'auth.users', 'pg_catalog.pg_tables', 'vault.secrets']) {
    await rejects(() => selectRows(table, 'select=*'), `must refuse ${table}`);
  }
}

/* ── 3. A caller-influenced table name — the exact future bug this prevents ── */
{
  // Imagine a route doing `selectRows(req.query.table, ...)`. Every one of these must throw.
  for (const hostile of [
    'reports; drop table reports',
    'reports/../push_tokens',
    'REPORTS',            // case-sensitive: only the exact literal passes
    'reports ',           // trailing space
    ' reports',
    '',
    'report_commentsX',
    'reports?select=*&push_tokens',
  ]) {
    await rejects(() => selectRows(hostile, 'select=*'), `must refuse ${JSON.stringify(hostile)}`);
  }
}

/* ── 4. Only the RPCs we own are callable ── */
{
  for (const fn of ['increment_reactionX', 'decrement_reactionX', 'pg_sleep', 'vault.create_secret', '', 'INCREMENT_REACTION']) {
    await rejects(() => rpc(fn, {}), `rpc must refuse ${JSON.stringify(fn)}`);
  }
}

/* ── 5. The allowed targets pass the guard ──
 *
 * They fail LATER (no Supabase env configured in this test), which is the point: the failure must
 * not be the allow-list. A guard that rejected everything would pass tests 1-4 while breaking the
 * feature — so assert these get *past* the guard. */
{
  const pastGuard = async (fn) => {
    try {
      await fn();
    } catch (e) {
      assert.doesNotMatch(
        String(e.message),
        /not in the Reports allow-list/,
        'allowed target must not be blocked by the allow-list',
      );
      return; // any other error (bad URL / fetch failure) means it got past the guard
    }
  };
  for (const table of ['reports', 'report_comments', 'report_reactions']) {
    await pastGuard(() => selectRows(table, 'select=id&limit=1'));
  }
  await pastGuard(() => rpc('increment_reaction', { p_report_id: 'x', p_emoji: '🚀' }));
  await pastGuard(() => rpc('decrement_reaction', { p_report_id: 'x', p_emoji: '🚀' }));
}

console.log('supabaseGuard.logic.test.mjs — all assertions passed');
