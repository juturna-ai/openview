# Task: TradingView-parity settings dialogs for drawing tools

## Goal
Give every drawing tool a TradingView-style tabbed settings dialog. Fib retracement gets
full 3-tab parity (matching the screenshots); all other tools get Style/Coordinates/Visibility.

## Done
- [x] Per-shape fib config (`s.fib` via `defaultFibConfig()`), lazy migration via `getFib(s)`.
- [x] `FIB_DEFAULT_LEVELS` — 24 TV default levels + colors (red/blue/gray/orange/indigo).
- [x] `drawFib` renders from per-shape config (levels, colors, extend, reverse, one-color, trend line).
- [x] `openFibSettings` — tabbed Style/Coordinates/Visibility dialog:
      Style = trend line, levels line, extend, reverse, label toggles, 24 level rows, use-one-color.
      Coordinates = price/bar for #1 & #2. Visibility = 8 time scopes.
- [x] Generic `openSettings` rewritten as tabbed dialog for all other tools, driven by `TOOL_CAPS`.
      Style caps: fill, text (+color+size), arrow toggle, extend (trend), label toggle.
      Coordinates tab = per-point price/bar rows. Visibility tab = 8 scopes on `style.visibility`.
- [x] Wired new render props: `fillColor`, `textColor`, `fontSize`, `extend` (trend), `arrow`.
- [x] Tests: test/regression_fib_settings.mjs (PASS), test/regression_tool_settings.mjs (PASS).
- [x] ARCHITECTURE.md updated.

## Review
- Fib defaults match screenshots (24 distinct levels; screenshots visually show ~26 but the
  distinct TV default set is 24). Values/colors verified in test.
- Backward compatible: shapes saved before this change get defaults on first render/edit.
- "Value is null" pageerrors on reload are PRE-EXISTING (a plain trend line reproduces them);
  unrelated to this change. Filtered in the regression tests.

## Not done / follow-ups
- Fib Fan / Fib Time Zone still render from hardcoded inline arrays (no per-shape level editor yet).
- Trend-Based Fib Extension (fibtbext) uses the generic dialog, not a fib level editor.
- `extend` only wired into the plain trend line render (info/angle omit it to avoid a no-op control).

## Audit pass — 2026-07-06 (review)

Full bug/regression audit of the single-file app.

**Bugs found & fixed:**
1. Chart render crash (HIGH): default spread NEAR-USD/INJ-USD loaded a series with one out-of-order bar time (index 1036: Jul-2025 → Sep-2022), tripping Lightweight Charts' "Value is null" render race (~82 crashes on rapid zoom-out, wedging the chart). Proven by BTC (clean series, same bar count/zoom) → 0 crashes vs spread → 82. Fixed with a strictly-ascending/dedupe guard at the top of renderData.
2. Fib settings listener leak (HIGH): openFibSettings bound an outside-click handler on the persistent #settingsDlg node via addEventListener on every open (8 opens = 8 live handlers). Fixed by tracking the handler on the node and removing the prior one before re-adding.
3. Compare stale-write (defensive, no observable failure): loadCompareData wrote to its captured series after an await with no re-check. Added a COMPARE[sym]!==c guard. Documented as defensive — the existing try/catch already swallowed the only throw, so not a reproducible bug.

**Cleared as safe (verified):** localStorage JSON.parse (all sites try/catch'd), indicator math (div-by-zero guarded, pair() filters non-finite), data-loader staleness guards, RSI render path (guarded + crash-proof at len=0/-5/NaN), drawing engine (out-of-range/degenerate shapes + empty-data render → 0 errors), Freeview Script sandbox (runs wrapped in try/catch), shape-load parse.

**Test conflict resolved:** regression_chart_render.mjs [4] asserted a stale ≥3px zoom-out floor that commit fa9926b intentionally removed (TradingView-like full zoom-out). Confirmed intent with user; rewrote [4] to assert the real invariant (chart doesn't wedge).

**End state:** regression suite 12/12 pass (was 10/11); added regression_audit_fixes.mjs; ARCHITECTURE.md + lessons.md updated. No commit/push.

## Zoom + refresh-bounce fixes — 2026-07-06

User report: (1) chart "bounces and goes blank for ~2s out of nowhere"; (2) zoom-in is capped, wants TradingView-style near-infinite zoom.

**Fixes:**
1. Zoom-in cap removed: replaced the fixed 8-bar minimum span with a shared `zoomSpanLimits()` helper that drives limits off BAR SPACING (px/bar) — zoom in until ~350px/bar (≈4 bars fill screen), out until 0.5px/bar or loaded history. Applied to all three zoom paths (wheel, keyboard +/-, time-axis drag). Verified: reaches ~200px/bar deep zoom.
2. Refresh bounce fixed: the silent 20s background refresh (`loadChart(sym,tf,true)`) was running the progressive loader and painting a partial FIRST PAGE mid-refresh, momentarily shrinking the series (proven: 2457→350 bars pre-fix) and jolting the zoomed view. Suppressed the first-page paint on keepView loads (`_painted = (paintedFromCache || keepView) ? 1 : 0`). Verified: deep-zoomed view held identical through 2 real 20s refresh cycles, 0 crashes.

**Investigated, not a separate bug:** a subagent spent 15+ min trying to reproduce a distinct deep-zoom "Value is null" render crash (the other freeze theory) — could NOT reproduce it. Deep zoom-in and future-whitespace panning are both self-clamping (LWC clamps setVisibleLogicalRange; MA series end flush at the last real bar). The user's freeze WAS the refresh bounce, now fixed.

**Noted for later (separate concern):** data loads log intermittent 404/429 (rate-limit) responses — some bars may come from failed/retried requests. Not the freeze; worth a separate reliability pass.

**End state:** regression suite 14/14 pass; added regression_zoom_refresh.mjs; ARCHITECTURE.md + lessons.md updated. No commit/push.
