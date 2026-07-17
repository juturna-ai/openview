// Pure-logic tests for the market proxy's upstream fetch (see upstream.ts: validateTarget,
// fetchAllowed).
//
// THE BUG (two facets):
//
//   1. fetchAllowed calls fetchFn(target, { signal, cache, headers }) with NO `redirect` option.
//      A real `fetch()` defaults to `redirect: 'follow'`, so a 3xx response from an allow-listed
//      host (e.g. api.kraken.com) is followed transparently to WHATEVER Location header it sends
//      back — including an internal/link-local address like 169.254.169.254 (cloud metadata
//      SSRF) — with no re-validation against ALLOWED_HOSTS or the https-only rule. The proxy ends
//      up fetching and returning attacker- or misconfig-controlled internal data.
//
//   2. fetchAllowed passes `res.headers.get('content-type')` straight through as the result's
//      contentType (falling back to 'application/json' only when the header is ABSENT). If an
//      allow-listed host is compromised or misconfigured and returns `text/html` (or any non-JSON
//      type) with a 200, that content-type is trusted verbatim and the proxy will serve HTML
//      into the app's own origin under a JSON-expecting endpoint.
//
// The helpers live in upstream.ts rather than route.ts so this file can import them under plain
// `node` — route.ts imports `next/server`, which doesn't resolve outside a Next build.
//
// Run: node web/app/api/market/proxy/route.logic.test.mjs

import assert from 'node:assert/strict';

const { validateTarget, fetchAllowed } = await import('./upstream.ts');

/* ── 0. validateTarget: cheap sanity checks (expected to PASS today) ── */

{
  assert.equal(validateTarget('http://api.kraken.com/0/public/Time'), null, 'http:// (non-https) must be refused');
}
console.log('✓ validateTarget refuses http://');

{
  assert.equal(validateTarget('https://evil.example.com/steal'), null, 'unknown host must be refused');
}
console.log('✓ validateTarget refuses an unknown host');

{
  const u = validateTarget('https://api.kraken.com/0/public/Time');
  assert.ok(u instanceof URL, 'allow-listed https host must be accepted');
  assert.equal(u.toString(), 'https://api.kraken.com/0/public/Time');
}
console.log('✓ validateTarget accepts an allow-listed https host');

/* ── helper: build a mock fetchFn that emulates real fetch's redirect-following semantics ──
   Real fetch, given `redirect: 'follow'` (the default when the option is omitted), follows a 3xx
   Location header itself and only ever returns the FINAL response to the caller — the caller
   never sees the intermediate 3xx or gets a chance to re-validate the hop target. We emulate that:
   if fetchAllowed does not pass `redirect: 'manual'`, our mock "follows" the chain internally
   before returning, exactly like the real thing would (and records every URL it actually hit). */

function makeRedirectFollowingMock(routes, fetchedUrls) {
  return async function mockFetch(url, opts) {
    const manual = opts && opts.redirect === 'manual';
    let current = url;
    let hops = 0;
    for (;;) {
      fetchedUrls.push(current);
      const route = routes[current];
      if (!route) {
        throw new Error(`mock fetch: no route registered for ${current}`);
      }
      if (route.status >= 300 && route.status < 400 && route.location) {
        if (manual) {
          // Caller asked to inspect redirects itself — hand back the 3xx untouched.
          return {
            status: route.status,
            headers: { get: (name) => (name === 'location' ? route.location : null) },
            text: async () => route.body ?? '',
          };
        }
        // Real fetch()'s default behavior: follow transparently, no re-validation.
        current = route.location;
        hops += 1;
        if (hops > 20) throw new Error('mock fetch: too many redirects (test safety valve)');
        continue;
      }
      return {
        status: route.status,
        headers: { get: (name) => (name === 'content-type' ? route.contentType ?? null : null) },
        text: async () => route.body ?? '',
      };
    }
  };
}

/* ── 1a. SSRF via redirect: allow-listed host 302s to an internal/link-local address.
   fetchAllowed must never let that internal URL actually be fetched, and must refuse (null). ── */

{
  const METADATA_URL = 'http://169.254.169.254/latest/meta-data/';
  const routes = {
    'https://api.kraken.com/x': {
      status: 302,
      location: METADATA_URL,
    },
    [METADATA_URL]: {
      status: 200,
      contentType: 'application/json',
      body: '{"role":"admin-instance-credentials"}',
    },
  };
  const fetchedUrls = [];
  const mock = makeRedirectFollowingMock(routes, fetchedUrls);

  const target = validateTarget('https://api.kraken.com/x');
  assert.ok(target, 'setup: https://api.kraken.com/x must itself validate');

  const result = await fetchAllowed(target, mock);

  assert.ok(
    !fetchedUrls.includes(METADATA_URL),
    `BUG 1: internal metadata URL must never be fetched, but fetchedUrls = ${JSON.stringify(fetchedUrls)}`,
  );
  assert.equal(
    result,
    null,
    'BUG 1: fetchAllowed must refuse (return null) a redirect to a non-allow-listed target instead of following it',
  );
}
console.log('✓ fetchAllowed refuses a redirect to an internal/link-local address (SSRF)');

/* ── 1b. Positive case: a 302 from one allow-listed https host to ANOTHER allow-listed https host
   SHOULD be followed, and the final host's 200 body returned. ── */

{
  const routes = {
    'https://api.kraken.com/y': {
      status: 302,
      location: 'https://api.kucoin.com/y2',
    },
    'https://api.kucoin.com/y2': {
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
    },
  };
  const fetchedUrls = [];
  const mock = makeRedirectFollowingMock(routes, fetchedUrls);

  const target = validateTarget('https://api.kraken.com/y');
  const result = await fetchAllowed(target, mock);

  assert.ok(result, 'a redirect between two allow-listed https hosts should be followed, not refused');
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"ok":true}');
}
console.log('✓ fetchAllowed follows a redirect between two allow-listed https hosts');

/* ── 1c. Redirect loop of allow-listed 302s must terminate with a refusal, not spin forever. ── */

{
  const HOPS = 5;
  const routes = {};
  for (let i = 0; i < HOPS; i++) {
    routes[`https://api.kraken.com/loop${i}`] = {
      status: 302,
      location: `https://api.kraken.com/loop${(i + 1) % HOPS}`,
    };
  }
  const fetchedUrls = [];
  const mock = makeRedirectFollowingMock(routes, fetchedUrls);

  const target = validateTarget('https://api.kraken.com/loop0');

  const resultPromise = fetchAllowed(target, mock);
  // Guard against an actual infinite loop hanging the test suite.
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('fetchAllowed did not terminate on a redirect loop (hung)')), 2000),
  );
  const result = await Promise.race([resultPromise, timeout]);

  assert.equal(result, null, 'a bounded redirect loop must terminate with a refusal (null), not follow forever');
}
console.log('✓ fetchAllowed terminates a redirect loop with a refusal instead of following forever');

/* ── 2a. Upstream content-type is trusted verbatim: a 200 with text/html must NOT be passed
   through — it must be forced to application/json so the proxy never serves HTML into the app's
   own origin. ── */

{
  const mock = async () => ({
    status: 200,
    headers: { get: (name) => (name === 'content-type' ? 'text/html' : null) },
    text: async () => '<script>alert(1)</script>',
  });

  const target = validateTarget('https://api.kraken.com/z');
  const result = await fetchAllowed(target, mock);

  assert.match(
    result.contentType,
    /json/i,
    `BUG 2: non-JSON upstream content-type must be forced to application/json, got "${result.contentType}"`,
  );
}
console.log('✓ fetchAllowed forces contentType to JSON when upstream returns text/html');

/* ── 2b. Positive case: a legitimate JSON content-type (with charset) is preserved verbatim. ── */

{
  const mock = async () => ({
    status: 200,
    headers: { get: (name) => (name === 'content-type' ? 'application/json; charset=utf-8' : null) },
    text: async () => '{"ok":true}',
  });

  const target = validateTarget('https://api.kraken.com/z');
  const result = await fetchAllowed(target, mock);

  assert.equal(result.contentType, 'application/json; charset=utf-8');
}
console.log('✓ fetchAllowed preserves a legitimate application/json content-type verbatim');

console.log('\nAll market-proxy upstream tests passed.');
