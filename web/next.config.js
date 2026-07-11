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
  async rewrites() {
    return {
      beforeFiles: [
        // Root -> engine document. `/home` is the Next landing page.
        { source: '/', destination: '/index.html' },
      ],
    };
  },
};

module.exports = nextConfig;
