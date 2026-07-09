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

# RSI alert line on RSI pane (2026-07-09)

## Plan
- [x] Reproduce: Playwright test proving dialog-created RSI alert IS saved but draws no line (`test/regression_rsi_alert_line.mjs` — t1 pass, t2-t4 fail pre-fix)
- [x] Fix: `updateRsiAlertLines()` — native LWC price lines on `rsiLine` for source:rsi/target:value alerts; hooked into `saveAlerts`, `loadAlerts`, "Alert lines" toggle, color change
- [x] Confirm: new test 4/4; `regression_alert_drag`, `regression_live_tick_alert_wick`, `regression_alert_sounds` pass; screenshot shows dashed line + 🔔 axis tag on RSI pane
- [x] ARCHITECTURE.md §8 Visual section updated

## Review
Root cause of "alert not created": creation always worked (persisted + evaluated + fires) — it was
invisible because `drawAlertLines()` only renders source:price alerts on the main pane. Fix adds
~20 lines. Also repaired `regression_alert_sounds.mjs`, broken by the earlier (pre-existing,
uncommitted) file-based ringtones change: t2 now skips `src:` ringtones (no `seq` to synthesize),
t5 counts relaxed to ≥20. Other sub-pane alert sources (macd/atr/cci/willr/volume) still draw no
line — their panes are dynamic subCharts; out of scope here.
NOT deployed: mobile app loads https://openview-opal.vercel.app, so the phone won't show the line
until the engine is redeployed (awaiting explicit go-ahead per rules).

# RSI alert: line drag + interval option (2026-07-09)

## Plan
- [ ] Failing test first (`test/regression_rsi_alert_interval_drag.mjs`): interval select in dialog, interval persisted, interval-TF evaluation, drag-to-move RSI line
- [ ] Dialog: Interval row (Same as chart + TF list), hidden for price/drawing sources; `a.interval` in adOk
- [ ] Model: `interval` in saveAlerts/emitAlertsChanged/migrateAlert; in defaultAlertMessage + alerts panel
- [ ] Eval: `sourceValue(key, data)` param; per-(sym|tf) bar cache via fetchTfBars w/ 30s stale-while-revalidate + live-tick tail patch; checkAlerts uses interval-aware values
- [ ] Drag: mousedown on rsiEl (skip axis area), hit-test priceToCoordinate ±6px, drag re-values via coordinateToPrice (clamped 0–100), mouseup saveAlerts; hover ns-resize cursor
- [ ] rsiAlertLines entries → {id,pl}; adjust regression_rsi_alert_line.mjs
- [ ] App: add `interval?` to EngineAlert type (mirror passes it through untouched)
- [ ] All alert regressions green; ARCHITECTURE.md; deploy on go-ahead
