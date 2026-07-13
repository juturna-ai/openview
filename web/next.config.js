/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output dir. A production `next build` writes to the same `.next` the dev server is
  // serving its chunks from, which silently breaks a running `npm run dev` (every /_next/static/*
  // asset 404s until the dev server is restarted). Set NEXT_DIST_DIR to build into a scratch dir
  // instead — e.g. `NEXT_DIST_DIR=.next-prod npx next build` — leaving the dev server alone.
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
  // Everything under public/ is served with `Cache-Control: public, max-age=0` by default, so
  // every jump to the Openview tab re-validates the 720 KB engine document and re-fetches its
  // icons/sounds over the network. These headers let the browser reuse them instead.
  async headers() {
    return [
      {
        // The engine document itself: serve from cache immediately, revalidate in the
        // background. A deploy is picked up on the next navigation rather than blocking this one.
        source: '/index.html',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate, stale-while-revalidate=86400' },
        ],
      },
      {
        // Immutable-in-practice binaries (icons, screenshots, sounds). Content-addressed by name,
        // and replaced by editing the file — a week of caching is safe and kills the refetch.
        source: '/:path(assets|images)/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }],
      },
    ];
  },
};

module.exports = nextConfig;
