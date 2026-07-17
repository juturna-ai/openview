// Tests for the cron bearer check (see cronAuth.ts).
//
// THE BUG THIS PREVENTS — found while verifying the live cron:
//
//   A CRON_SECRET containing any non-ASCII character (an em-dash, a curly quote, an accent — all
//   trivially easy to paste in from a password manager, a doc, or a template) cannot be put in an
//   HTTP header at all:
//
//     TypeError: Cannot convert argument to a ByteString because the character at index 31
//                has a value of 8212 which is greater than 255
//
//   Header values are ByteStrings (latin-1). So the *caller* throws before the request is even
//   sent, and — worse — a route comparing `header === 'Bearer ' + secret` can never match, so a
//   correctly-configured cron silently 401s forever with no hint as to why. The failure looks like
//   "wrong secret" when the real problem is "this secret can never be transmitted".
//
//   timingSafeEqual has the same trap for a different reason: it throws on length-mismatched
//   buffers, which turns a wrong-length guess into a 500 instead of a clean 401.
//
// Run: node web/app/api/reports/_lib/cronAuth.logic.test.mjs

import assert from 'node:assert/strict';

const { checkCronAuth, isTransmittableSecret } = await import('./cronAuth.ts');

const req = (auth) => new Headers(auth ? { authorization: auth } : {});

/* ── 1. No secret configured → open (a deploy missing the var still runs the cron) ── */
{
  assert.equal(checkCronAuth(req(), undefined), 'ok');
  assert.equal(checkCronAuth(req(), ''), 'ok');
}

/* ── 2. Happy path ── */
{
  const s = 'a'.repeat(64);
  assert.equal(checkCronAuth(req(`Bearer ${s}`), s), 'ok');
  assert.equal(checkCronAuth(req(`Bearer ${s}x`), s), 'unauthorized', 'longer token rejected');
  assert.equal(checkCronAuth(req(`Bearer ${'b'.repeat(64)}`), s), 'unauthorized');
  assert.equal(checkCronAuth(req(), s), 'unauthorized', 'missing header rejected');
  assert.equal(checkCronAuth(req(s), s), 'unauthorized', 'bare token without Bearer rejected');
}

/* ── 3. Length mismatch must be a clean reject, never a throw ── */
{
  const s = 'a'.repeat(64);
  assert.equal(checkCronAuth(req('Bearer short'), s), 'unauthorized');
  assert.equal(checkCronAuth(req('Bearer ' + 'a'.repeat(200)), s), 'unauthorized');
}

/* ── 4. THE REGRESSION: a non-ASCII secret is misconfiguration, not "unauthorized" ──
 *
 * It must be reported distinctly so the operator learns the secret is unusable, rather than
 * chasing a phantom auth failure. And it must never throw. */
{
  const bad = '<any long random string — e.g. `openssl rand -hex 32`>'; // the real placeholder
  assert.equal(checkCronAuth(req('Bearer whatever'), bad), 'misconfigured');
  assert.equal(checkCronAuth(req(), bad), 'misconfigured');
  // The exact character that caused it: em-dash U+2014 = 8212.
  assert.equal(checkCronAuth(req('Bearer x'), 'abc—def'), 'misconfigured');
  assert.equal(checkCronAuth(req('Bearer x'), 'curly’quote'), 'misconfigured');
  // 'café' is NOT misconfigured: é is U+00E9, inside latin-1, so it transmits fine. Only
  // above-U+00FF characters are unusable — the boundary is latin-1, not ASCII.
  assert.equal(checkCronAuth(req('Bearer x'), 'café'), 'unauthorized');
  assert.equal(checkCronAuth(req('Bearer café'), 'café'), 'ok', 'a latin-1 secret still works');
}

/* ── 5. isTransmittableSecret is the predicate behind that ── */
{
  assert.equal(isTransmittableSecret('plain-ascii-64'), true);
  assert.equal(isTransmittableSecret('a'.repeat(64)), true);
  assert.equal(isTransmittableSecret('has—emdash'), false);
  assert.equal(isTransmittableSecret('ByteString-boundary:ÿ'), true, 'U+00FF is the last latin-1 char');
  assert.equal(isTransmittableSecret('over-boundary:Ā'), false, 'U+0100 is one past it');
  // A newline can't be a header value either (header injection / invalid).
  assert.equal(isTransmittableSecret('has\nnewline'), false);
}

console.log('cronAuth.logic.test.mjs — all assertions passed');
