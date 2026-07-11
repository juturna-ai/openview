/** @type {import('next').NextConfig} */
const nextConfig = {
  // The chart engine is a self-contained static document at public/index.html (copied
  // byte-for-byte from the original repo root). The deployed mobile app + the multi-chart
  // grid depend on it being served AT THE ROOT PATH `/` and reachable via `/index.html?…`
  // with query params intact. These rewrites reproduce the exact pre-migration contract:
  //   GET /                      -> engine (public/index.html)
  //   GET /?embed=1&sym=&tf=      -> engine (query preserved automatically)
  //   GET /index.html?…          -> engine (query preserved automatically)
  // App Router pages (/home, /about, /contact, /portfolio, /chart) are unaffected because
  // rewrites only fire for paths that don't match a page/route first.
  // A bare visit to the site root (openview.site/) should land on the Home page — but the
  // mobile app and grid iframes reach the engine via `/?embed=1&…`, which MUST keep serving
  // the chart. So: redirect `/` → `/home` ONLY when there is no `embed` query param. Redirects
  // run before rewrites, and `missing` scopes this to requests without `embed`, so
  // `/?embed=1&sym=&tf=` skips the redirect and falls through to the engine rewrite below.
  async redirects() {
    return [
      {
        source: '/',
        missing: [{ type: 'query', key: 'embed' }],
        destination: '/home',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        // Root -> engine document (only reached when `embed` IS present; a bare `/` was
        // already redirected to /home above). Query params are preserved automatically.
        { source: '/', destination: '/index.html' },
      ],
    };
  },
};

module.exports = nextConfig;
