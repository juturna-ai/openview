# Gainers & Losers — rebuild as CMC-backed multi-tab market page

## Goal
Replace the current metals/FX-only Gainers & Losers with Reach's real **CoinMarketCap-backed**
market page: 6 crypto tabs, plus **2 new sections we add** — Metals and Stocks/ETFs.

Reference: `D:\Projects\Reach` → `electron/main.js` (data) + `src/components/GainersLosers/GainersLosers.jsx` (UI).

## Research findings (all VERIFIED LIVE — see notes)

### How Reach connects to CoinMarketCap
- **No API key.** Reach hits CMC's *undocumented public* `data-api/v3` endpoints — the same ones
  coinmarketcap.com's own frontend uses. Requires a **browser User-Agent** header or it fails.
- Two endpoints cover 5 of the 6 tabs:
  1. `…/cryptocurrency/listing?start=1&limit=N&sortBy=market_cap&sortType=desc&convert=USD…`
     → the full ranked coin list (`data.cryptoCurrencyList`). Reach sorts it locally for
     gainers/losers and slices it for Leaderboards. `limit` = pool size (default 500).
  2. `…/cryptocurrency/spotlight?dataType=7&limit=30` → `trendingList`, `mostVisitedList`,
     `gainerList`, `loserList` in ONE call.
     `…/spotlight?dataType=8&limit=30` → `recentlyAddedList`.
     ⚠ `limit` must be **5–30** — outside that the API 400s.
- **Fear & Greed** gauge (Community Sentiment tab) = `https://api.alternative.me/fng/?limit=1`
  (keyless). Returns `{value, value_classification}`.
- Coin logos: `https://s2.coinmarketcap.com/static/img/coins/64x64/{id}.png`.
- ✅ Verified live today: listing returns real coins; spotlight dataType=7 returns all 4 lists (30 each)
  and dataType=8 returns recentlyAdded; F&G returned `28 / "Fear"` — matches the user's screenshot.

### Metals + Stocks/ETFs (the 2 extra sections the user asked for)
- Existing `/api/market/movers` already does **metals** via Yahoo `v8/finance/chart` (real price +
  `chartPreviousClose` + volume) and **currencies** via Frankfurter. Keep and extend.
- ✅ Verified: the **same Yahoo endpoint serves stocks/ETFs** — AAPL/NVDA/SPY/QQQ all returned live
  price, previous close, and volume. **So Stocks/ETFs needs no new provider and no API key.**

### Constraints
- CLAUDE.md: never call an external API from the browser → all upstream calls go through
  **server-side Next.js API routes**. (Also necessary here: CMC's data-api would CORS-block.)
- `gl-*` CSS classes (`.gl-page`, `.gl-cmc-table`, `.gl-change-pill`, …) **already exist** in
  globals.css from the current MoversView — large reuse, only new classes needed for tabs/gauge.

## Plan

### 1. API routes (server-side; keys not needed, but UA header is)
- [ ] `web/app/api/market/cmc/route.ts` — proxies CMC. One handler, `?dataset=` switch:
      - `listing` (pool size param, clamp ≤ 1000)
      - `spotlight` (dataType 7 + 8 in parallel; clamp limit to 5–30)
      - `feargreed`
      Normalize each coin to one shape: `{id, cmcRank, symbol, name, slug, price, change1h,
      change24h, change7d, change30d, volume, marketCap, thumb}`.
      In-memory cache (~30s) so the 30s client poll doesn't hammer upstream. Fail soft → empty lists.
- [ ] Extend `web/app/api/market/movers/route.ts` with a **stocks/ETF** list (Yahoo, same fetcher as
      metals). Add `assetType: 'stock'`. Keep metals + currencies working.

### 2. UI — rewrite `MoversView.tsx` as the 6-tab page + 2 extra sections
- [ ] Tab bar (8 total): Leaderboards · Gainers & Losers · Trending · Most Visited ·
      Recently Added · Community Sentiment · **Metals** · **Stocks/ETFs**
- [ ] Per-tab title/subtitle strings (copy Reach's exactly).
- [ ] **Gainers & Losers** tab: timeframe dropdown (1h/24h/7d/30d → change1h/24h/7d/30d) + pool
      dropdown (Top 100 / Top 500 / All). Pool filter = `volume > 50000` always, then `cmcRank <= pool`.
      Two tables (gainers desc / losers asc).
- [ ] **Leaderboards**: `allCoins` sorted by marketCap desc, top 30.
- [ ] **Trending / Most Visited / Recently Added**: straight from spotlight lists.
- [ ] **Community Sentiment**: F&G gauge (thresholds ≥50 green, ≥25 yellow, else red; bar width =
      value) + Most Bullish / Most Bearish, each top 15 ranked by `volume * change24h` momentum.
      Per-row bar = `clamp(50 + change24h*2, 0, 100)`.
      ⚠ Reach has a **bug** here: sentiment table headers are clickable but it maps `list` instead of
      `sortList(list)`, so sorting silently does nothing. **Fix in our port** (wire sortList).
- [ ] **Metals** + **Stocks/ETFs** tabs: reuse the existing gainer/loser table off `/api/market/movers`.
- [ ] Sorting: click col → desc, click same col again → asc; reset on tab change.
- [ ] Formatters: port `fmtPrice` (8/6/2 decimal tiers), `fmtVol`, `fmtMcap` verbatim.
- [ ] 30s poll + manual refresh button w/ last-updated timestamp; loading + empty states.
- [ ] Coin icon = CMC thumb `<img>` w/ colored-initial fallback on error.

### 3. Styles + docs
- [ ] Add CSS for the tab bar, dropdowns, F&G gauge, sentiment bars (reuse existing `gl-*` where possible).
- [ ] Update ARCHITECTURE.md: new route, data sources, tab map, the no-key CMC discovery.

## Open risks
- CMC's `data-api/v3` is **undocumented** — it can change or rate-limit without notice. Mitigate:
  server-side cache + fail-soft empty lists (never crash the page). Worth stating in ARCHITECTURE.md.
- Yahoo is similarly unofficial; already relied on for metals, so no new risk class.

## Review — DONE

All 8 tabs built and verified against live upstreams.

**Files**
- NEW `web/app/api/market/cmc/route.ts` — CMC proxy (listing / spotlight×2 / Fear & Greed), 30s cache
  keyed by pool size, each source fails soft and independently.
- NEW `web/app/home/wallet/CoinIcon.tsx` — CMC logo w/ coloured-initial fallback.
- NEW `web/app/home/wallet/movers.logic.test.mjs` — 15 assertions, all pass.
- `web/app/api/market/movers/route.ts` — added 16 stocks/ETFs; factored the Yahoo fetch into a shared
  `yahooRow()` used by both metals and stocks.
- `web/app/home/wallet/MoversView.tsx` — rewritten as the 8-tab page.
- `web/app/home/wallet/icons.tsx` — +trophy/flame/eye/clock/users.
- `web/app/globals.css` — tab bar, selects, coin avatar, rank/mcap/sentiment cells, F&G gauge;
  `.gl-sections` → 2-col grid ≥1100px (bullish/bearish sit side by side, as in the screenshots).
- `ARCHITECTURE.md` — new route, CMC no-key discovery + risk, tab/derivation table, the fixed bug.

**Verified live**
- `/api/market/cmc?limit=100` → 100 coins, 30 trending, 30 most-visited, 30 recently-added,
  Fear & Greed `28 / "Fear"`. BTC $62,578 / −2.17%. Matches the user's screenshots.
- `/api/market/movers` → 30 rows (4 metals, 16 stocks, 10 currencies) with real prices/changes/volume.
- `npx tsc --noEmit` clean; `npx next build` **succeeds**.

**Reach bug found + fixed (the "address any bug" ask)**
Reach's Community Sentiment table wires sortable headers but renders `list.map()` instead of
`sortList(list).map()` — clicking a header silently does nothing. Ours routes every table through
`sortList`. Proved with a failing-then-passing test: the repro asserts Reach's renderer leaves the
list in momentum order (`XEC, WBTC`) under a price-desc sort, while ours correctly yields `WBTC, XEC`.
(First attempt at the repro was a false pass — the fixture's momentum order happened to already be
price-descending, so bug and fix looked identical. Fixture rebuilt so the two orders genuinely differ.)

**Side effect worth noting:** `npx next build` previously failed at page-data collection for
`/api/market/movers` (pre-existing, confirmed on a clean tree earlier). Refactoring that route fixed
it — the build is now green end to end.

**Known risk (documented in ARCHITECTURE.md):** CMC's `data-api/v3` is undocumented; it can change or
rate-limit without notice. Mitigated by fail-soft empties + server cache, but it's not a contract.
