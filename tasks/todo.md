# Symbol search — full coverage (Big-5 crypto exchanges + every asset class)

## Goal
The Add-symbol dialog finds effectively every live pair TradingView shows — crypto from
8 exchanges, plus US stocks/ETFs, FX, indices, futures — and every result is CHARTABLE
(candles fetchable), not just listed. TradingView's own directory is closed (403 +
ToS); coverage comes from each venue's official keyless API instead.

## Decisions locked with the user
- Scope: Big 5 (Kraken, OKX, KuCoin, Gate.io, MEXC) + all non-crypto asset classes.
- Verified live counts: OKX 1,308 · KuCoin 1,040 · Kraken 1,515 · Gate 2,229 · MEXC 2,212
  (+ existing Coinbase 527 / Binance 1,363 / Bybit 592 + perps).

## Crypto — 5 new venues (web/public/index.html)
- [ ] Catalog fetchers merged into loadProducts() allSettled pool
- [ ] Leg prefixes KRAKEN:/OKX:/KUCOIN:/GATE:/MEXC: in resolveLeg + EX_ORDER + tabs
- [ ] Kline adapters in fetchPage(): Kraken OHLC (720-bar cap) · OKX candles+history ·
      KuCoin candles · Gate candlesticks · MEXC klines (Binance-shaped); proxyJSON where no CORS
- [ ] Per-venue TF interval mapping

## Non-crypto (server route + engine)
- [ ] web/app/api/market/symbols/route.ts — NASDAQ Trader nasdaqlisted.txt + otherlisted.txt
      → ~11k US stocks/ETFs, cached server-side 24h, served same-origin
- [ ] Engine loads it into PRODUCTS as YF: legs (existing Yahoo kline branch — no new adapter)
- [ ] Curated in-engine lists: FX majors+crosses (=X), world indices (^…), futures (=F)
- [ ] Yahoo live search stays for international coverage; quotesCount 30 → 50

## Verification
- [ ] Browser: search rows per new venue; load 1 chart per venue (candles paint)
- [ ] Stocks/FX/indices/futures rows appear and chart (AAPL, SPY, EURUSD=X, ^GSPC, GC=F)
- [ ] Existing Coinbase/Binance/Bybit + spread builder unaffected

## Docs
- [x] ARCHITECTURE.md: route map + engine venue table + search dialog section

## Review (2026-07-17)
Shipped. Catalog went 4,288 → **24,579 symbols in ~3.3s**: 8 crypto venues
(Coinbase 527 · Binance 1,936 · Bybit 1,299 · Kraken 1,407 · OKX 1,308 ·
KuCoin 1,040 · Gate.io 2,225 · MEXC 2,105) + 12,637 US stocks/ETFs + 95 curated
FX/indices/futures, with live Yahoo search on top for international. 14/14
chart-load checks pass race-free (one per venue + stock/ETF/FX/index/futures +
spread regression), all data fresh, zero page errors, 16/16 logic tests.
Notes: Kraken history is capped at its newest ~720 bars (API has no backward
cursor); CORS-blocked venues ride /api/market/proxy (allow-listed); public
CORS-proxy chain demoted to last resort after it proved too slow/small for
catalog payloads (the 85s partial load during verification).

---

# Reports tab — AI market reports + community wall

## Goal
`/home/reports` was an empty scaffold. Build four tabs — **Dashboard** (a Facebook/Instagram-style
wall), **Daily**, **Weekly**, **Monthly** — where each period report ranks the top-20 gainers from
CoinMarketCap plus a Binance trading-pairs section, with an LLM writing the commentary. Reports
generate automatically at **1 PM Cancún**. Objective: **catch assets while they're just starting to
move**, and share that read with people.

## Decisions locked with the user
- Storage: Supabase in the web app; **anonymous** (no login). Writes via server routes + IP rate limit.
- LLM: **Gemini Flash** free tier primary, **Groq** `llama-3.1-8b-instant` fallback **on 429 only**.
- Twitter/X: **skipped** — no free read tier ($100/mo minimum). Free sentiment proxies instead.
- Schedule: **one** Vercel cron, `0 18 * * *` (= 1 PM Cancún, UTC-5, **no DST since 2015**).
- Quality gate (strict): mcap > $10M, vol > $1M, rank ≤ 500, drop |change| > 1000%.

## Research — all VERIFIED LIVE, not assumed
| Finding | Consequence |
|---|---|
| CMC listing returns 500 coins; `percentChange24h/7d/30d` all non-null | One call feeds all 3 periods |
| CMC listing **only** sorts by market cap | Rank in-process (as `MoversView` does) |
| Raw monthly top gainers = **ANSEM +152,296%**, CASHCAT +8,486% | The gate is **load-bearing**, not polish |
| Binance `ticker/24hr` = 1.9 MB, **no** 7d/30d field | Server-side only; klines needed for w/m |
| Binance `exchangeInfo` = **17 MB** | Never call it |
| 60 klines @10-concurrent = **1.84s**, zero 429s | Full pass ≈ 5s vs Vercel's 60s limit |
| Only **174** USDT pairs clear the $1M volume floor | The illiquid tail was never actionable |

## Phase 1 — live reports, no database  ✅ SHIPPED
- [x] `_lib/types.ts`, `_lib/gate.ts` — the quality gate + in-process ranking
- [x] `_lib/gate.logic.test.mjs` — pins real ANSEM/CASHCAT values, asserts they never appear
- [x] `_lib/cmc.ts` — listing + spotlight + Fear & Greed (fail-soft per source)
- [x] `_lib/binance.ts` — bulk 24hr (daily) + batched klines (weekly/monthly)
- [x] `_lib/llm.ts` — Gemini→Groq-on-429, validated JSON, enforced disclaimer
- [x] `_lib/llm.logic.test.mjs` — 8 contract assertions incl. the 429-only fallback rule
- [x] `_lib/sentiment/x.ts` — documented seam for X, returns null
- [x] `_lib/build.ts` — composes the report
- [x] `api/reports/preview/route.ts` — 3h TTL cache + single-flight, `maxDuration = 60`
- [x] `Sidebar.tsx` — `ReportsTab` + NAV (reused existing icons, added none)
- [x] `ReportsShell.tsx` — WalletShell tab pattern (mount-once, keep-mounted, idle prewarm)
- [x] `PeriodView.tsx`, `DashboardView.tsx`, `dataCache.ts`
- [x] CSS — `rp-` classes on `var(--bg)`, no border/tint
- [x] ARCHITECTURE.md §17 + `.env.example`

## Phase 2 — persistence + the wall  ✅ SHIPPED
Project: **`koedodxkryyxizcryggy`** (Openview's own — NOT `gfdebbumdbrmzvpnyvsm`, which is UDG's
music-events app that the global `SUPABASE_PROJECT_REF` points at).
- [x] `web/supabase/schema.sql` — reports/report_comments/report_reactions/keep_alive, RLS public
      SELECT + **zero write policies**, `increment_reaction()` security-definer. Applied by the user.
- [x] `.mcp.json` — hardcodes the Openview ref instead of inheriting UDG's global var; writes allowed
      but **ask the user before every write**.
- [x] `_lib/supabase.ts` (anon read / service-role write), `_lib/rateLimit.ts`, `_lib/cronAuth.ts`
- [x] Routes: `cron` (`0 18 * * *`), `generate`, `list`, `[id]`, `comment`, `react`
- [x] `vercel.json` — 2nd cron (Hobby ceiling now full)
- [x] `DashboardView` feed with persisted reactions + comments; `PeriodView` reads stored, falls back
      to `preview`
- [x] `nickname.ts` (localStorage, unverified by design)

## Verified against the LIVE database — not assumed
| Check | Result |
|---|---|
| anon key SELECT | 200 |
| **anon key INSERT** | **401 — blocked by RLS** (the check that makes an anonymous wall safe) |
| service_role SELECT | 200 |
| service_role not `NEXT_PUBLIC_` | confirmed |
| write path | `generate` → real row in Supabase, 20 coins / 20 pairs, **0 gate violations** |
| **cron idempotency** | 2 authenticated runs, **both `saved=true`**, still **1 row**, same id, `updated_at` advanced |
| cron auth | wrong secret → 401; unsendable secret → 500 `misconfigured` + log |
| reactions | atomic 1→2→3; bad emoji → 400; bad uuid → 400 |
| comments | 200; empty → 400; nonexistent report → 502 (FK) |
| rate limit | 6th comment in 10 min → 429 |
| **wall in a real browser** | reaction 🚀3→🚀4 and comment **both survived a reload** (server-side, not local state); 0 page errors |
| build / typecheck / lint | all clean; 3 test files pass |
Test data (4 comments, 1 reaction) deleted afterwards with the user's approval; report row preserved.

## Bug found + fixed during verification
**A `CRON_SECRET` with any non-latin-1 char can never authenticate.** The placeholder contained an
em-dash; HTTP header values are ByteStrings, so `fetch` throws and a naive compare answers 401
*forever* — sending you to chase an auth bug that doesn't exist. Now returns a distinct
`misconfigured` (500) with an explicit log. `_lib/cronAuth.ts` + `cronAuth.logic.test.mjs`; same
guard inlined in `keep-alive/route.ts`. Prove-it pattern: test written first, RED, then fixed.

## Review — what was verified, and how
- `npm run build` ✅ · `npx tsc --noEmit` ✅ · `next lint` ✅ (0 warnings)
- Both test files pass under plain `node`
- **Live route through the real dev server on :3333**: 20 gated coins + 20 Binance pairs, **zero gate
  violations**, ANSEM/CASHCAT absent. Cache: **3.97s cold → 0.013s warm** (~300x).
- **Real Chromium**: all 4 tabs render, 40 rows, tab round-trip keeps state (no refetch), **0 console
  errors**, no horizontal scroll at 1400px or 820px.
- **Analysis path proven end-to-end against a local mock LLM** (`GEMINI_BASE_URL` override):
  provider=gemini, 20 theses matched to 20 real coins, **0 orphans**, canonical disclaimer enforced.
- Cross-validation: BANK/DGB/KAITO/MANTRA appear independently in both the CMC and Binance lists.

## Needs the user's attention
1. **`CRON_SECRET` is still the placeholder** in `web/.env.local` — both cron routes return
   `misconfigured` until it's a plain-ASCII value (`openssl rand -hex 32`). Nothing else is blocked.
2. **`GEMINI_API_KEY` / `GROQ_API_KEY`** still unset — reports build and render fine; the analysis
   section honestly says "Analysis unavailable" instead of inventing commentary.
3. **Restart Claude Code** for the `.mcp.json` change to take effect (the live MCP session still
   holds UDG's project). Test: `list_tables` must show reports/report_comments/report_reactions —
   if it shows venues/artists, it didn't take.
4. **UDG's project no longer gets a keep-alive ping** from this app — it pauses after 7 days idle
   unless something else touches it.
5. **`service_role` key rotation deferred** — it appeared in a screenshot (2026-07-16). Fine while
   this project holds only public market data; revisit before anything sensitive lands.
6. **The honest limit**: with X skipped, the model sees only numbers — it can say *what* moved and on
   what volume, never *why*. It's prompted to say "no clear catalyst identified" rather than invent
   one. Real causal explanation needs a news/X source.
7. **The wall's reaction dedupe is UI courtesy, not enforcement** — no accounts means no identity to
   enforce against, and the in-memory rate limit is per-lambda. Fine for emoji on a market report;
   not fine if a tally ever needs to be trustworthy.

---

# 2026-07-17 — Autonomous bug/regression audit (/loop)

## Plan
- [x] Fan out 3 audit subagents: new market API routes, index.html diff, rest of web/app
- [x] Baseline: lint, tsc, all 16 logic-test suites (all green before changes)
- [x] Fix confirmed findings (Prove-It where unit-testable)
- [x] Re-verify: lint, tsc, tests, production build
- [x] Update ARCHITECTURE.md
- [x] Review section (below)

## Review — what was found and fixed

**Fixed (7 files):**
1. `web/app/api/market/proxy/upstream.ts` (new) + `route.ts` — extracted proxy logic; **SSRF hardening**:
   redirects now followed manually (max 3 hops), every hop re-validated against the allow-list (default
   `redirect:'follow'` would have let an upstream 3xx pivot the server to internal addresses); non-JSON
   upstream content-types forced to `application/json`; added `query1.finance.yahoo.com` to the allow-list.
2. `web/app/api/market/proxy/route.logic.test.mjs` (new) — 8 tests, written FIRST and confirmed failing
   (SSRF + content-type reproduced), pass after the fix.
3. `web/app/api/market/symbols/route.ts` — single-flight dedup for concurrent cold-cache requests
   (parity with coinlogos/cmc; was double-fetching two ~10k-line files).
4. `web/public/index.html` — 4 Yahoo call sites (chart, search, 2× 5d spark) switched `proxyJSON` →
   `fetchJSONDirectOrProxy` so Yahoo uses the app's own proxy instead of only the flaky public chain.
5. `web/app/home/wallet/WalletTrackerView.tsx` — `openDetail` race: stale wallet-A response could
   overwrite wallet-B's just-opened detail panel; latest-request-wins seq guard.
6. `web/app/home/wallet/AssetIcon.tsx` — `failed`/`triedFallback` never reset when the symbol prop
   changed (recycled instance showed letter-chip for a loadable logo); render-time reset keyed on
   symbol|assetType.
7. `web/app/home/reports/DashboardView.tsx` + `PeriodView.tsx` — mount-fetch vs manual-Refresh race on
   first empty-cache visit; latest-load-wins seq guard.

**No test for items 5–7** — component-level async races; the repo has no React test harness (plain-node
logic tests only), and adding jest/RTL for these would be a large dependency change. Documented here
per the Prove-It escape hatch.

**Found, deliberately NOT changed (product/design calls, flagging only):**
- `deleteTrade()` in journal `trades.ts` exported but never called — no UI way to remove a trade.
- TradeModal collects "Leverage" but `computePnl` ignores it — leveraged P&L shows raw notional move.
- ContactForm relies on `mailto:` — silently no-ops on machines without a mail client.
- `fetchOlderPages` doesn't special-case Kraken like Yahoo (harmless no-op call chain, self-heals).
- `logoUrl()` in index.html is now dead code (superseded by `iconHtml`/`logoChain`).
- Pre-existing duplicate `icTrash` definition in index.html (predates current diff).

**Verified after fixes:** tsc clean, ESLint clean, all 17 logic-test suites pass, `next build` succeeds.

---

# 2026-07-17 — Follow-up: fix the 5 deferred items

- [x] `deleteTrade` UI: right-click a day with trades → "Manage Trades…" → per-row Delete
      (TradingCalendar.tsx manage panel + globals.css `.trade-manage*`).
- [x] Leverage now affects P&L. Per user's call ("Size = margin, ×leverage"): `computePnl` extracted
      to trades.ts, takes `leverage`, notional = margin × leverage. Modal field relabelled
      "Position Size" → "Margin (USD)"; `amount_asset` scaled too. Test: `journal/pnl.logic.test.mjs`
      (reproduces the old leverage-ignored bug, passes after fix).
- [x] ContactForm: submit now shows a confirmation panel with a copy-to-clipboard address as the
      fallback for machines with no mail client (mailto gives no callback).
- [x] index.html dead code removed: `logoUrl()` (0 refs) and the shadowed first `icTrash()` definition
      (the second, simpler one wins in JS and is the one used).
- [x] React race fixes now have a test where feasible: the P&L extraction gave us a unit-testable
      seam. The three async-race guards (wallet detail, AssetIcon reset, reports load) remain
      component-level and untested — no React harness in-repo; not adding jest/RTL for three guards.

**Verified:** tsc clean, ESLint clean, all 18 logic suites pass, `next build` succeeds.
