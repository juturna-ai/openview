# features.md verification loop

## Phase 0 — Setup (DONE)
- [x] Locate features.md (root, was empty → now populated, 178 lines)
- [x] Set up Playwright browser verification (`test/` dir, local install, reuses cached Chromium) — smoke test passes, screenshots + console-error capture working
- [x] Confirm live server up (systemd `freeview.service`, http://127.0.0.1:5501, HTTP 200)

## Phase 1 — Audit (DONE)
Result: 145 items · 87 verified-working (✅) · 58 remaining. All checked items browser-verified.


Browser-verify every features.md line against the running app. Fan out by section
(1–9) to subagents, each driving the shared `test/` Playwright harness. Each line
gets a verdict: WORKS (verified in browser) / PARTIAL (exists but incomplete) /
MISSING (not implemented). Then rewrite features.md with real `- [ ]` checkboxes:
✅ + verify-note for WORKS, unchecked for PARTIAL/MISSING.

- [x] Section 1 — Chart Types
- [x] Section 2 — Timeframes & Data
- [x] Section 3 — Drawing Tools
- [x] Section 4 — Indicators
- [x] Section 5 — Alerts
- [x] Section 6 — Layout & UI (TradingView visual parity)
- [x] Section 7 — Watchlist
- [x] Section 8 — Symbol Info & Extras
- [x] Section 9 — Performance & Quality
- [x] Synthesize verdicts → rewrite features.md with checkboxes

## Phase 2 — Loop (PENDING)
Work each unchecked item one at a time: implement → browser-verify → mark ✅ with
note. Do not advance until current item verified. Match TradingView visual design
(section 6). Loop until every item ✅.

## Review

### Iteration 1 — Section 1 Chart Types (DONE)
Added 9 missing chart types (HLC bars, Line w/ markers, Step line, Columns, High-Low,
Renko, Kagi, Point & Figure, Line break). Files: index.html (CHART_TYPES menu,
auxSeries factory, 4 price-transform fns renkoData/kagiData/pnfData/lineBreakData,
applyChartType routing + MA-hide/fitContent on transforms), ARCHITECTURE.md (chart-types
section), features.md (16/16 §1 now ✅). All 9 browser-verified via Playwright
(test/ct*.png), zero app console errors. Fixed a Kagi algorithm bug (bad reversal
condition) caught in first screenshot pass.

Progress: 96 ✅ / 49 remaining.

### Iteration 2 — Section 2 small items (DONE)
- Custom timeframe input: #tfCustom field + parseCustomTF/applyCustomTF (dynamic TF["c<sec>"]).
  Verified "45m" renders (base 15m). 
- Bar-close countdown: #barCountdown pill via updateCountdown() 1s tick. Verified ticking.
Files: index.html (tf menu input+CSS+parser, countdown el+CSS+logic+interval), ARCHITECTURE.md, features.md.
Progress: 98 ✅ / 47 remaining.

### Remaining big/architectural items to FLAG before autonomous build:
- Real-time WebSocket (replaces 20s polling — touches data layer)
- Infinite scroll-back (lazy history on pan)
- Multi-chart layouts 1/2/4 grid + sync
- Bar replay mode
- Light theme toggle (touches all colors)
Can't-do client-side (no backend): Supabase server-side alerts, Supabase watchlist sync.

### Iteration 3 — Session/timezone selector (DONE)
Topbar #tzSel dropdown (9 zones) + tzShift/tzOffsetMin applied to tickLabel + crosshairTimeFmt,
persisted fv_tz. Verified UTC→Tokyo(+9)→NY(-5) shift + reload persistence. Session part N/A (crypto 24/7).
Files: index.html (TIMEZONES/tzShift/crosshairTimeFmt, topbar dropdown+wiring, localization), ARCHITECTURE.md, features.md.
Progress: 99 ✅ / 46 remaining. Section 2 done except flagged architectural items.

### Iteration 4 — §3 drawing behaviors (DONE)
Undo/redo (snapshot stack + Ctrl+Z/Y/Shift+Z), stay-in-drawing-mode toggle,
per-drawing lock (context menu + drag/delete guards). All browser-verified
(undo 3→2→1, redo 1→2, stay kept tool="trend", locked-delete blocked).
Files: index.html (draw.stay, _undo/_redoStack + snapshotDraw at every mutation,
per-shape s.locked + guards, keydown Ctrl+Z/Y, stay toolbar toggle+icon), ARCHITECTURE.md, features.md.
Progress: 102 ✅ / 43 remaining.

### Iteration 5 — 4 new §3 drawing tools (DONE)
Regression Trend (least-squares + ±1σ), Gann Box, Circle (constrained radius),
Arrow Marker (up/down, dir from click vs close). Added TOOLS/CLICKS/icons/draw fns/hitTest.
All browser-verified (drawn, correct types+dir, render confirmed via screenshot, no errors).
Files: index.html (4 tools end-to-end), ARCHITECTURE.md (tool list), features.md.
Progress: 106 ✅ / 39 remaining. §3 done except Elliott wave + XABCD (flagged: large multi-point tools).

### Iteration 6 — indicator pane UX (DONE)
Pane resize by drag (.paneResize grip + wirePaneResize), indicator hide/show eye
toggle (toggleIndicatorHidden, sub-pane + legend). Browser-verified: RSI pane resized
120→190px, RSI hidden=true + pane dimmed, eye present in pane and legend.
Files: index.html (CSS + pane grip/eye + 2 fns + legend eye), ARCHITECTURE.md, features.md.
Progress: 108 ✅ / 37 remaining.

### Iteration 7 — persistence + state restore (DONE)
Indicator persistence (fv_indicators_<symbol>, type/params/hidden; save on
add/remove/hide/settings, load boot+symbol-switch). Full state-restore: fv_active_symbol/tf
+ validateRestoredTF (rebuilds custom c<sec> TFs). Browser-verified: 3 indicators+bb len 30+macd
hidden survive reload; BONK-USD+4h+custom 45m restored.
Files: index.html (INDICATORS_KEY + save/load + hooks, saveActiveState + validateRestoredTF + hooks),
ARCHITECTURE.md (persistence table), features.md.
Progress: 110 ✅.

### Iteration 8 — §11 indicator parity (DONE, via subagent)
Added 22 missing indicators (mcginley, kama, ckstop, lrc, tsi, kst, rvi, smi, woodies,
crsi, eom, klinger, netvol, volosc, twap, bbpct, histvol, massidx, ulcer, bbp, ribbon,
hl52). Catalog now ~76. All 22 independently re-verified (in catalog, add cleanly with
series+data, baseline sma/rsi/macd intact, zero errors). Skipped interactive/complex:
ZigZag, SMI Ergodic, Anchored VWAP, Divergence, Pivot Points HL, Session Vol Profile, Auto Fib.
Files: index.html (4 edit-sites × 22), ARCHITECTURE.md, features.md (5 §11 lines ✅).
Progress: 115 ✅ / 56 remaining.

### Iteration 9 — indicator dialog tabs + favorites (DONE)
Technicals/Favorites tabs + ★ per row (persisted fv_ind_favorites). Verified starred
SMA+VWMA show in Favorites tab + survive reload; 2 tabs, 76 stars, no errors.
§11 now fully complete. Files: index.html (dialog rewrite + CSS), ARCHITECTURE.md, features.md.
Progress: 117 ✅ / 54 remaining.

### Iteration 10 — §10 watchlist import/export + session breaks (DONE)
Watchlist import/export .txt (###SECTION format, ⭱/⭳ header btns, exportWatchlist/importWatchlistText).
Session breaks (drawSessionBreaks — intraday day-boundary verticals). Browser-verified:
export content correct, import built CRYPTO/ALTS sections, 115 breaks on 1h / 0 on 1D.
Files: index.html, ARCHITECTURE.md, features.md. Progress: 119 ✅ / 52 remaining.

### Iteration 11 — screenshot + fullscreen + keyboard shortcuts (DONE)
📷 saveScreenshot (chart.takeScreenshot + overlay → PNG), ⛶ fullscreen, keyboard
(arrows pan, +/- zoom, Alt+H hline). Browser-verified: valid 77KB PNG with chart+MAs,
fullscreen handler clean, pan 121→118→121 / zoom 540→648→450 / Alt+H added hline.
Files: index.html, ARCHITECTURE.md, features.md. Progress: 122 ✅ / 49 remaining.

### Iteration 12 — legend change% + symbol-search button (DONE)
OHLC legend now shows change abs+% (vs prev close, green/red, on load + hover);
symbol name in topbar clickable → symbol-search modal. Browser-verified: legend shows
"−0.0007058 (−0.17%)", symbolBox click opens #symDlg with search input.
Files: index.html, ARCHITECTURE.md, features.md. Progress: 123 ✅ / 48 remaining.

### Iteration 13 — watchlist flags + indicator hover values (DONE)
Watchlist flag/color (right-click → 6 colors, SYMBOL_FLAGS/fv_flags, ⬤ dot).
Indicator hover values (recordData wraps setData; updateIndLegendValues fills .vals/.subVals
at crosshair time). Browser-verified: flag #ffd600 on BONK persists; SMA 0.4205→0.4309 +
RSI 50.7→41.3 across hover positions. Progress: 125 ✅ / 106 remaining.

### PHASE 3 — §15/§16 TradingView visual parity rebuild (COMPLETE — all 8 steps A–H done)
Iteration 19 finished Step F (left-rail flyout categories). Full rebuild done: A(fonts) B(floating
legend) C(toolbar 38px) D(bottom bar) E(left-rail restyle) F(flyout categories) G(watchlist polish)
H(dialogs). Browser-verified each. App now closely mirrors TradingView chrome. Progress: 156 ✅ / 75 remaining.
Baseline screenshot: test/baseline_before_parity.png. Steps:
- [x] Step A: Global font (Trebuchet MS/TV stack) + grid colors confirmed — DONE
- [x] Step B: On-chart floating legend — DONE (symbol row + OHLC + MA + indicator rows, topbar decluttered)
- [x] Step C: Toolbar reorder + 38px + dividers + rounded hover — DONE
- [x] Step D: Bottom bar (date-range shortcuts + tz/scale relocated) — DONE
- [x] Step E: Left-rail restyle (52px, 26px monochrome icons, active blue) — DONE
- [x] Step F: Left-rail flyout categories — DONE (6 categories + corner-arrow flyouts + bottom cluster)
- [x] Step G: Watchlist polish (28px rows, full tickers, sortable headers, flash) — DONE
- [ ] Step H: Dialog/tooltip/context-menu restyle (rounded, #1E222D, subtle shadow)
Preserve all existing functionality; screenshot before/after each step.

### Iteration 15 — visual rebuild Step E + polish (DONE)
Step E left-rail restyle: 52px rail, 26px thin-line monochrome #b2b5be icons, active #2962ff.
Confirmed dialogs/menus already TV-styled (#1e222d, rounded, shadow) + crosshair dashed w/ axis labels.
Browser-verified: railW=52, svg 26px, active tool blue. Progress: 138 ✅ / 93 remaining.
Rebuild done: A(font) B(floating legend) E(left-rail) H(dialogs). Remaining: C(toolbar reorder/38px),
D(bottom bar UTC/Auto + date-range), F(left-rail flyout categories), G(watchlist polish).

### NOTE (round 2): user expanded features.md AGAIN — added sections 14-16:
- §14 Mobile App (Expo/React Native in /mobile) — ~18 items, ENTIRE separate app + stack. Major effort. FLAG.
- §15 Visual Parity dashboard fixes (~28 items) — toolbar reorder, move UTC/Auto to bottom bar,
  left-toolbar flyout categories, on-chart legend, bottom date-range bar, TV fonts/colors, restyle dialogs.
- §16 Pixel Parity round 2 (~20 items) — REBUILD toolbar (remove OHLC/Auto/UTC/Script, 38px, reorder),
  on-chart floating legend, REBUILD left rail into 10 flyout categories, watchlist polish.
§15+§16 heavily overlap = a full TradingView visual-clone overhaul that RESTRUCTURES working UI
(removes/moves existing toolbar items, rebuilds left rail). Per project rules (don't refactor working
code unless asked) this needs explicit user go-ahead + likely a dedicated session, not autonomous loop ticks.

### NOTE: user expanded features.md — added sections 10-13 (unchecked now 61):
- §10 Additions: replay control bar, session breaks, alert webhooks, watchlist import/export
- §11 Full indicator parity: ~50 more TradingView indicators (DEMA/TEMA/HMA/…, TRIX/TSI/…, CMF/MFI/…, etc.)
- §12 Custom scripting: Pine-editor panel, JS indicator API, built-in fns, Pine v5 parser, strategy tester
- §13 Visual parity pass: pixel-level TradingView comparison, exact fonts/spacing/icons/dialogs
These are MUCH larger scope. §11 is mechanical (add catalog entries + calc fns) — batchable.
§12 (Pine parser, strategy tester) + §13 (pixel-perfect clone) are large multi-day efforts — FLAG.

### Remaining, grouped:
- FLAGGED architectural (pause for user): WebSocket, infinite scroll-back, multi-chart 1/2/4,
  bar replay, light theme, Elliott wave, XABCD patterns.
- Small/safe next: Volume profile indicator, pane resize by drag, hide/show indicator (eye),
  indicator crosshair-hover values, indicator persistence, alert improvements (per-bar freq,
  alert-on-drawing, alert log), symbol-search topbar button, legend OHLC+change%, screenshot export,
  keyboard shortcuts (pan/zoom/Alt+H), watchlist flag-color, symbol info panel, compare overlay,
  state-restore (symbol), 5000-bar load.
- CAN'T-DO client-side: Supabase server alerts, Supabase watchlist sync.

### Iteration 20 — Volume Profile + legend collapse (DONE)
Volume Profile overlay indicator (drawVolumeProfile, POC orange, pane:"overlay" special-cased
in add/removeIndicator). Legend collapse chevron (#legCollapse). Fixed legend z-index (110>canvas)
so its controls are clickable while container pointer-events:none passes chart clicks through.
Browser-verified: histogram pixels + POC, collapse hides/restores rows, drawing still works.
Progress: 158 ✅ / 73 remaining.

### Iteration 21 — compare overlay + symbol info panel (DONE)
Compare symbols overlay (＋Compare btn, addCompare/loadCompareData — %-normalized line on
own hidden scale + legend chip + reload on TF change). Symbol info popover (right-click symbol
→ structured details). Browser-verified: BTC-USD overlay 2758 pts renders + removable chip;
info popover 6 rows. Progress: 160 ✅.
Small-item well now essentially dry. Remaining ~77 unchecked are the big flagged features
(§12 Pine parser/strategy tester, §14 mobile app, WebSocket, infinite scroll, multi-chart,
bar replay, light theme) + backend-dependent (Supabase sync/alerts, mobile push).
CHECKPOINT: recommend user picks which big feature(s) to prioritize next.

### PHASE 4 — big features (user approved ALL FOUR groups). Sequence:
1. Real-time WebSocket ✅ (iteration 21b — Coinbase ws-feed, live tick verified 62638.54→.55, backoff reconnect)
2. Infinite scroll-back (next)
3. Light theme toggle
4. Bar replay mode
5. Multi-chart layouts 1/2/4 grid
6. §12 Pine editor + strategy tester (largest; Pine v5 parser hardest)
Progress: 162 ✅ / 75 remaining.

### Iteration 22 — infinite scroll-back (DONE) + pre-existing bug found
Big feature #2: loadOlderHistory/fetchOlderPages prepend older bars on left-edge pan
(visible from<30), guarded, view-preserving. Verified BTC-USD 1h 5161→7564 bars (+2403).
Files: index.html (fetchOlderPages, loadOlderHistory, range subscription, reset in loadChart).

### ⚠ PRE-EXISTING BUG FOUND (not caused by this work):
"Value is null" pageerrors (3 on NEAR default load, 8 on BTC-USD 1h) thrown from inside
LWC's Line series render during paint. Reproduces on plain symbol switch WITHOUT scroll-back
OR websocket (confirmed by disabling each). Likely a line/indicator series (MACD signal/hist
shorter range, or an MA warmup) hitting a null during setData/range-shift. Violates §9
"no console errors". NEEDS its own Prove-It cycle (subagent to repro minimally + fix).
Flagged to user. Scroll-back itself works; error rate not worsened by it.
Progress: 163 ✅.

### ⚠⚠ INCIDENT (recovered): served index.html got reverted to committed original
During "Value is null" bug diagnosis, the live index.html was overwritten back to the
last commit (26c6f56, 4358 lines) — wiping ALL 22 iterations of work (0 occurrences of
every feature marker). ROOT CAUSE: a diagnostic step / interrupted worktree-subagent copied
a base/un-instrumented copy over the served file.
RECOVERY: full version survived in scratchpad/index_live_backup.html (343KB, 5747 lines,
all features intact + well-formed). Restored it. Verified in browser: 6 flyout cats, floating
legend, bottom bar (9 shortcuts), 14 TFs, 77 indicators, chart renders, 2420 bars.
Durable backup now at _docs/index.full.backup.html.
LESSON: never let a diagnostic/subagent copy over the served index.html; instrument via
Playwright page.evaluate injection instead, or work on a COPY served on a different port.
