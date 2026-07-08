# §14 Mobile App — OpenView (Expo/React Native, /openviewapp)

## Plan
- [x] 1. `.mcp.json` — Supabase MCP server (env-based `SUPABASE_PROJECT_REF`/`SUPABASE_ACCESS_TOKEN`, read-only, no secrets)
- [x] 2. Expo scaffold in `/openviewapp` (package.json, app.json, tsconfig, babel, metro, .gitignore, .env.example)
- [x] 3. Config (offline-first gating) + Supabase client + anonymous device-ID auth
- [x] 4. Shared AppState (symbol/tf/chartType/indicators) + `supabase/schema.sql` + `alert-watcher` Edge Function
- [x] 5. Bottom tab nav (Watchlist/Chart/Alerts/Menu) + exact-TV dark theme
- [x] 6. Chart screen: `ChartWebView` of deployed engine (`?embed=1&sym=&tf=`), touch-optimized + live postMessage bridge
- [x] 7. Symbol search modal (Coinbase products, TV mobile styling)
- [x] 8. Watchlist screen: live Coinbase prices, tick flash, local store + `sync_state` sync
- [x] 9. Timeframe + chart-type bottom-sheet switcher
- [x] 10. Indicators modal: add/remove/configure period, pushed to WebView
- [x] 11. Drawings per-symbol store + sync; WebView `drawingsChanged` round-trip
- [x] 12. Alerts screen (CRUD/pause) + `priceWatcher` (in-app fire) + notifications (sound/badge) + Expo Push scaffold + tap→chart
- [x] 13. Install deps (1217 pkgs, expo-doctor 17/17) + typecheck CLEAN
- [x] 14. features.md §14 → all [x], ARCHITECTURE.md §13 added

## Review
Full Expo Router app built under `/openviewapp` (folder per user request; §14 header updated from `/mobile`). All 18 §14 rows implemented and marked complete.

**Verification:** `npm install` OK; `npx tsc --noEmit` → exit 0 / no errors; `npx expo-doctor` → 17/17.

**Bugs caught in self-review (fixed before verify):**
- `config.ts` read env via dynamic `process.env[key]` — Expo only inlines **static** `process.env.EXPO_PUBLIC_*` member expressions. Rewrote to static reads.
- Missing `babel-plugin-module-resolver` for the `@/*` alias — added to devDeps + installed.
- `watchlist.tsx` passed a `fontSize`-bearing style to a `<View>` — removed the Text-only style from the View.
- Excluded `supabase/functions` (Deno runtime) from the RN tsconfig.

**Requires the user (blocked in a non-interactive session):**
- Provide Supabase URL + anon key in `openviewapp/.env` (offline until then; app fully usable meanwhile).
- Set `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN`, then authorize the Supabase MCP server interactively (`/mcp`).
- Run `supabase/schema.sql`, enable Anonymous sign-ins, deploy + cron the `alert-watcher` Edge Function.
- Set the deployed chart URL (`EXPO_PUBLIC_CHART_ENGINE_URL`) so the WebView loads the real engine.

**Not runtime-verified:** no device/simulator run and no live Supabase (offline-first path only) — typecheck + doctor are the proof at this stage.
