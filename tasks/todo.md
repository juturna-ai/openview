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
