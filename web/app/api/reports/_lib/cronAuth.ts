// Bearer check for cron-triggered routes.
//
// Extracted from the route (and kept free of runtime imports) so it's testable under plain node —
// the auth path is exactly the kind of thing that must not be verified only by hitting a live URL.
//
// ── Why this is more than `header === 'Bearer ' + secret` ──
//
// Found while verifying the live cron: if CRON_SECRET contains ANY non-ASCII character — an
// em-dash, a curly quote, an accented letter, all of which arrive routinely via copy-paste from a
// doc, a password manager, or a template — then no caller can ever authenticate, because HTTP
// header values are ByteStrings (latin-1 only). `fetch` throws outright:
//
//   TypeError: Cannot convert argument to a ByteString because the character at index 31
//              has a value of 8212 which is greater than 255
//
// The naive comparison then answers "unauthorized" forever, which is a lie: the secret isn't
// wrong, it's *unusable*. An operator would rotate keys, re-check Vercel, and re-read the docs
// chasing an auth bug that doesn't exist. So an untransmittable secret is reported as its own
// state — `misconfigured` — and the route logs it plainly.
//
// Timing: the compare is length-checked first and then constant-time, so a wrong-length token is a
// clean reject rather than a throw, and a right-length one leaks nothing through timing.

/**
 * Can this string be sent in an HTTP header value?
 *
 * Header values are latin-1 (U+0000..U+00FF), and CR/LF/NUL are structurally illegal in them
 * (header injection). Anything else can never reach the server, so it can never match.
 */
export function isTransmittableSecret(secret: string): boolean {
  for (const ch of secret) {
    const c = ch.codePointAt(0) ?? 0;
    if (c > 0xff) return false;
    if (c === 0x0a || c === 0x0d || c === 0x00) return false;
  }
  return true;
}

/** Constant-time compare. Length is checked first (and leaks only length, which isn't secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type CronAuthResult = 'ok' | 'unauthorized' | 'misconfigured';

/**
 * Check a request's Authorization header against the configured secret.
 *
 * - No secret configured → `ok`. Deliberate: a deploy that hasn't had the var added yet still runs
 *   its cron rather than silently failing every night. Same contract as /api/keep-alive.
 * - Secret can't be transmitted → `misconfigured` (never a misleading `unauthorized`).
 */
export function checkCronAuth(headers: Headers, secret: string | undefined): CronAuthResult {
  if (!secret) return 'ok';
  if (!isTransmittableSecret(secret)) return 'misconfigured';

  const header = headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return 'unauthorized';
  return safeEqual(header.slice('Bearer '.length), secret) ? 'ok' : 'unauthorized';
}
