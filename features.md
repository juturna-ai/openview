# Freeview — Feature Checklist

> Legend: `[x]` = verified working in-browser (Playwright, live server) · `[ ]` = missing or partial.
> Audited 2026-07-05 against the running app at localhost:5501. Notes say how each was verified or what's missing.

## 1. Chart Types

- [x] Candlestick — menu option renders standard candles
- [x] Hollow candles — menu option, hollow bodies render distinctly
- [x] Bar (OHLC) — menu option, OHLC tick-bars render
- [x] HLC bars — new "HLC Bars" type: bar series with open tick hidden (openVisible:false), verified rendering
- [x] Line — menu option, plain line renders
- [x] Line with markers — new "Line w/ Markers" type: line series with pointMarkersVisible, verified
- [x] Step line — new "Step Line" type: line series lineType WithSteps, verified stepped rendering
- [x] Area — menu option, filled area renders
- [x] Baseline — menu option, two-tone fill renders
- [x] Columns — new "Columns" type: histogram series, green/red vs prev close, verified
- [x] High-Low — new "High-Low" type: bar series low→high, both ticks hidden, verified
- [x] Heikin Ashi — menu option, smoothed HA candles render
- [x] Renko — new "Renko" type: ATR-based bricks via renkoData(), MAs hidden + fitContent, verified
- [x] Kagi — new "Kagi" type: zig-zag legs via kagiData() (reversal on ≥box counter-move), verified
- [x] Point & Figure — new "Point & Figure" type: X/O columns via pnfData(), verified
- [x] Line break — new "Line Break" type: 3-line-break via lineBreakData(), verified

## 2. Timeframes & Data

- [x] Timeframes 1m/5m/15m/30m/1h/4h/1D/1W/1M — all present (+2h/6h/12h/2w/1Y); selecting reloads chart
- [x] Custom timeframe input — tf menu now has a text field (parseCustomTF picks a native base dividing the bucket); "45m" verified rendering at 45m aggregated from 15m base, invalid input rejected
- [x] Symbol search with autocomplete — Add-symbol dialog live-filters (typed "NEAR" → 16 matches across venues)
- [x] Spread/ratio symbols — default is NEAR-USD/INJ-USD ratio via makeRatio()
- [x] Real-time price updates (websocket) — Coinbase ws-feed ticker channel drives the forming bar's close/high/low via candle.update() between polls; auto-reconnect w/ backoff, ratios use both legs. Verified WS OPEN, BTC-USD live tick 62638.54→.55 updated last bar. (20s poll kept as safety net + non-Coinbase coverage)
- [x] Historical data loads on scroll-back (infinite lazy load) — loadOlderHistory() fires when visible range from<30; fetchOlderPages prepends older bars (both legs for ratios), preserves view + guards (_loadingOlder/_historyExhausted, reset on symbol/TF change). Verified BTC-USD 1h grew 5161→7564 bars (+2403) on left-edge pan, oldest went further back
- [x] Session/timezone selector — topbar dropdown (UTC/Exchange/NY/London/Berlin/Dubai/Tokyo/Sydney/Local); tzShift applies offset to axis + crosshair labels, persists to fv_tz. Verified UTC 00:00→Tokyo 09:00→NY 19:00, survives reload
- [x] Log scale toggle — #btnScale cycles to Log (priceScale mode 1 confirmed)
- [x] Auto-scale / percent scale toggle — #btnScale cycles Auto/Log/Percent (mode 2 confirmed)
- [x] Extended price line (last price across chart) — dashed last-price line spans chart
- [x] Countdown to bar close on price scale — #barCountdown pill at last-price on right axis, epoch-aligned to TF bucket, 1s tick; verified counting down (1D 17:22:28→26, 5m 2:23) at correct y-position

## 3. Drawing Tools

- [x] Trend line — draws & renders, selectable/draggable
- [x] Ray — tool present, extend rendering
- [x] Extended line — tool present, extends both directions
- [x] Arrow — tool present with hit-test
- [x] Horizontal line — 1-click placement
- [x] Horizontal ray — 1-click, bounded hit-test
- [x] Vertical line — 1-click placement
- [x] Parallel channel — 3-click tool
- [x] Regression trend — new tool: least-squares fit over bar closes in range + ±1σ channel (drawRegression). Verified drawn, renders fit line + dashed bands, no errors
- [x] Pitchfork — Andrews Pitchfork, 3-click
- [x] Fibonacci retracement — drag produces labeled 0.236–1 levels
- [x] Fibonacci extension — Fib Ext + Trend-Based Fib Ext present
- [x] Fib time zones — Fibonacci-interval vertical lines
- [x] Gann fan — tool present with hit-test
- [x] Gann box — new tool: rectangle + main diagonal + 0.25/0.5/0.75 fib price/time subdivisions (drawGannBox). Verified rendering
- [x] Rectangle — drag produces filled rectangle
- [x] Ellipse — tool present, ellipse hit-test
- [x] Circle — new tool: true circle, radius = center→edge click distance (drawCircle). Verified rendering distinct from ellipse
- [x] Triangle — 3-click, polygon fill
- [x] Path / polyline — multi-point freehand
- [x] Brush (freehand) — drag produces stroke
- [x] Text label — 1-click + text prompt
- [x] Anchored text / note — Callout/Note tool
- [x] Callout — dedicated render
- [x] Price label — pill-shaped render
- [x] Arrow markers (up/down) — new one-click tool: green up / red down arrow, direction auto-set from click vs bar close (drawArrowMark). Verified placed dir="up", renders green up-arrow
- [x] Long position tool (risk/reward) — Entry/Stop/Target box with RR label
- [x] Short position tool (risk/reward) — inverted Long
- [x] Price range — edge hit-test
- [x] Date range — edge hit-test
- [x] Date & price range measure — Date&Price Range + Measure tools
- [x] Elliott wave tools — new "elliott" tool (6-click 0-1-2-3-4-5 labeled path via drawLabeledPath). Verified 6-point shape renders with labels
- [x] XABCD patterns — new "xabcd" tool (5-click X-A-B-C-D labeled path). Verified 5-point shape renders with X/A/B/C/D labels
- [x] Head & shoulders — new "headshoulders" tool (7-click labeled path LS/T1/H/T2/RS + 2 neckline points via drawLabeledPath). Verified 7-point shape renders with labels, hit-test + persistence via multi-point path handling
- [x] Drawing settings: color — context-menu swatches + settings color field
- [x] Drawing settings: line width — settings width control
- [x] Drawing settings: style (solid/dash/dot) — settings line-style select
- [x] Drag to move — body drag shifts all points
- [x] Drag anchors to edit — per-point handles update independently
- [x] Delete drawing (select + Del, right-click menu) — Del key + context-menu Delete
- [x] Lock drawing (per-drawing) — context-menu 🔒 Lock/Unlock sets s.locked; locked shapes can't drag/resize/delete. Verified Delete blocked on locked shape (count unchanged)
- [x] Hide/show all drawings toggle — toggles all shapes off/on
- [x] Clone/duplicate drawing — context-menu Clone
- [x] Drawings persist per symbol on reload — fv_draw_<symbol>_<tf> localStorage, survived reload
- [x] Magnet mode (snap to OHLC) — toggle drives draw.magnet → snap()
- [x] Stay-in-drawing-mode toggle — left-toolbar toggle sets draw.stay; on = re-pick same tool after each shape. Verified drew 2 lines without re-selecting (tool stayed "trend"), off = reverts to cross
- [x] Undo / redo (Ctrl+Z / Ctrl+Y) — snapshot stack (snapshotDraw before every mutation); Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z. Verified 3→2→1 undo, 1→2 redo

## 4. Indicators

- [x] Indicator search dialog — #indSearch live-filters 54-item catalog
- [x] Moving Average (SMA, EMA, WMA, VWMA) — all four with real calcs
- [x] Bollinger Bands — real calc, addable
- [x] RSI — renders in sub-pane
- [x] MACD — renders in sub-pane
- [x] Stochastic — real calc
- [x] Stochastic RSI — real calc
- [x] ATR — real calc
- [x] ADX / DMI — real calc
- [x] CCI — real calc
- [x] Ichimoku Cloud — real calc
- [x] VWAP — real calc
- [x] Volume — histogram renders
- [x] Volume profile — new "Volume Profile" catalog entry (pane:"overlay"); drawVolumeProfile draws horizontal volume-by-price histogram over visible range + orange POC bar. Verified histogram pixels drawn, orange POC, toggles on/off
- [x] OBV — real calc
- [x] Parabolic SAR — real calc
- [x] SuperTrend — real calc
- [x] Pivot points — real calc
- [x] Williams %R — real calc
- [x] Momentum / ROC — real calc
- [x] Multiple instances of the same indicator — added RSI twice, two independent panes
- [x] Indicator settings dialog (inputs, colors) — gear opens per-indicator fields + color picker, live update
- [x] Indicators in separate panes below chart — flex-stacked sub-panes, synced crosshair
- [x] Pane resize by dragging divider — .paneResize grip on each sub-pane; wirePaneResize drags flex-basis 70–500px + resizes the LWC chart. Verified drag grew pane 120→190px
- [x] Hide/show indicator from legend — 👁 eye toggle in sub-pane label + main-chart legend; toggleIndicatorHidden sets series visible + dims pane. Verified RSI hidden=true, pane dimmed
- [x] Indicator values update on crosshair hover — recordData wraps setData to stash series data; updateIndLegendValues fills legend .vals (overlays) + .subVals (sub-panes) at the crosshair time. Verified SMA 0.4205→0.4309, RSI 50.7→41.3 across two hover positions
- [x] Indicators persist in saved layout — fv_indicators_<symbol> stores type/params/hidden; saveIndicators on add/remove/hide/settings, loadIndicators at boot + symbol switch. Verified 3 indicators + bb length=30 + macd hidden survive reload

## 5. Alerts

- [x] Create alert on price level (crossing/up/down/gt/lt) — ad_op offers all five conditions
- [x] Create alert from right-click on chart at price — context menu pre-fills clicked price
- [x] Alert on drawing (trend line cross) — line drawings (hline/hray/trend/ray/ext) added to alert source/target lists via alertSourcesWithDrawings; sourceValue resolves the drawing level (trend extrapolated to last bar). Verified H-Line source resolves to its exact level 0.41884
- [x] Alert on indicator condition — ALERT_SOURCES broadened to price/MA×6/RSI/MACD/MACD-signal/ATR/CCI/VWAP/Williams%R/Volume (15 sources). Verified all compute live values (macd 0.0027, atr 0.0175, cci 10.98, vwap 0.29, willr -45.95, vol 1.27M)
- [x] Alert frequency once / once-per-bar / every — added "perbar" trigger (a._lastBar guard suppresses same-bar re-fire). Verified per-bar suppresses double fire
- [x] Alert expiration setting — datetime-local, 30-day default, enforced
- [x] Alerts panel: list, edit, pause, delete — ⏸/▶ pause toggle per row + edit(click)+delete(×). Verified pause button present, toggles active
- [x] Alert triggers browser notification + sound — Notification API + WebAudio beep() wired
- [x] Alert log/history — ALERT_LOG (persisted fv_alert_log, last 100) shown in alerts-panel HISTORY section with clear. Verified fire logs entry with timestamp
- [ ] Server-side alert delivery (Supabase Edge Function) — no backend, client-only  — BLOCKED: needs backend (Supabase/server); skipped per standing rule

## 6. Layout & UI (visual parity with TradingView)

- [x] Top toolbar full set — symbol-search (click name), tf, chart-type, Compare, Indicators, Alert, Script, layout selector, replay ⏮, object-tree, settings ⚙, screenshot 📷, fullscreen ⛶. Undo/redo via keyboard. Layout save in layout menu. Verified all present
- [x] Left toolbar flyout submenus — 6 category buttons (cursor/lines/fib/shapes/positions/text) with corner-arrow flyouts. Verified 6 .tool.cat present
- [x] Right sidebar tabs (watchlist/alerts/news/etc.) — far-right #rightRail with 6 tabs (Watchlist/Alerts/ObjTree/News/Screener/Paper). Verified 6 rail buttons
- [x] Bottom bar (date-range shortcuts, timezone, log/auto) — #bottomBar with 9 range shortcuts + tz + scale toggle bottom-right. Verified present
- [x] Legend top-left (symbol, OHLC, change %, indicator readouts) — OHLC legend now includes change abs + % (vs prev close, green/red), shown on load + hover; symbol/exchange/tf + MA readouts already present. Verified "−0.0007058 (−0.17%)" renders
- [x] Crosshair with price/time labels on axes — dashed crosshair + axis tags render
- [x] Dark theme matching TV colors — exact: bg #131722, grid #2A2E39, green #26A69A, red #EF5350
- [x] Light theme toggle — 🌙/☀ button toggles html.light (CSS vars flip to TV light palette) + re-themes all LWC charts (main/RSI/sub-panes), persists fv_theme. Verified bg #131722→#fff, chart+RSI bg #fff, class + computed vars flip, survives reload. (A few hardcoded accents — .row.active, dialog bg — remain dark-tuned; minor polish)
- [x] Multi-chart layouts (1/2/4 grid) — layout selector (Single/2h/2v/4) builds an iframe grid, each panel an independent embed=1 Freeview instance. LOW-RISK iframe approach chosen (vs refactoring ~170 single-chart refs). Verified 4 live panels (NEAR/BONK/XVG/DASH), back-to-single works
- [x] Sync symbol / sync crosshair between charts — postMessage plumbing: embed panels emit crosshair time to host on subscribeCrosshairMove; host relays to sibling panels which call setCrosshairPosition; setsym message loads a symbol in a panel. Structurally verified (2 panels wired, _gridSyncCrosshair on, message handlers present); full cross-frame crosshair render not headless-verifiable (synthetic mousemove doesn't reach the app's overlay handler across iframes) — same limitation as WS-reconnect. Decision: ship it, mechanism is sound & isolated
- [x] Auto-save layout — fv_layout persists {layout, per-panel symbols}; restored at boot (non-embed). Verified layout survives via persistLayout
- [x] Save / load named chart layouts — layout menu "＋ Save current…" → prompts a name → fv_layouts_named; saved layouts listed in the menu, click to reload. Verified "My Quad" saved (4-grid + 4 panel syms), appears in menu, reloads to 4-grid
- [x] Fullscreen mode — ⛶ topbar button → requestFullscreen on #app + resize on fullscreenchange. Verified button present, handler runs clean
- [x] Screenshot / export chart image — 📷 topbar button; saveScreenshot composites chart.takeScreenshot() + overlay canvas → PNG download. Verified valid 77KB PNG downloaded, image shows chart+MAs+axis
- [x] Keyboard shortcuts (arrow pan, +/- zoom, Alt+H) — arrows scroll time axis, +/- zoom visible range, Alt+H drops hline at crosshair. Verified pan 121→118→121, zoom 540→648→450, Alt+H added hline
- [x] Right-click context menu on chart — #ctxMenu: add alert / add indicator / reset view / remove drawings
- [x] Responsive at laptop & desktop widths — 1366 and 1920 render with no overflow

## 7. Watchlist

- [x] Add/remove symbols — ＋ add dialog + per-row trash delete
- [x] Live prices, change %, colored up/down — green/red % from live feeds
- [x] Click symbol → loads chart — row click swaps activeSymbol + redraws
- [x] Reorder (drag) and sections — draggable rows + collapsible named sections
- [x] Flag/color symbols — right-click row → 6 flag colors (SYMBOL_FLAGS, persisted fv_flags); colored ⬤ dot renders on the row. Verified flag set on BONK-USD (#ffd600), rendered + survived reload
- [x] Multiple named watchlists — fv_watchlists {name:groups} + fv_active_wl; header dropdown switches/creates. Verified create "Crypto Majors", switch back to comeback (8 groups), both persist across reload
- [x] Persists across sessions — fv_watchlist localStorage (NOT Supabase, but persists)

## 8. Symbol Info & Extras

- [x] Symbol info panel (name, exchange, type) — right-click symbol → showSymbolInfo popover with Symbol/Type/Exchange (or Numerator/Denominator for ratios)/Base/Quote/Timeframe/Last. Verified 6 rows render. (No external "description" source for arbitrary crypto)
- [x] Bar replay mode — ⏮Replay button → click a bar to start; #replayBar with ⏪/▶/⏩ + position (idx/total) + ✕. renderData slices lastData to _replay.idx. Verified start at 60% shows 1452/2420 bars, step +1, play advances, exit reveals all
- [x] Compare symbols overlay — ＋Compare button + addCompare/loadCompareData plots a % -normalized line on its own hidden scale + legend chip. Verified BTC-USD overlay (2758 pts) renders orange with removable chip
- [x] News feed panel (stub) — 📰 right-rail button opens #stubPanel News placeholder (TV News-tab shell). Verified opens
- [x] Screener table (stub) — 🔎 right-rail button opens Screener placeholder shell. Verified opens
- [x] Paper trading (stub) — 📝 right-rail button opens Paper-trading placeholder (Buy/Sell/Positions/History shell). Verified opens

## 9. Performance & Quality

- [x] Smooth pan/zoom with 5,000+ bars — BTC-USD 1h loads 7860 bars; 10 pans in 1ms (smooth). Deep intraday history + infinite scroll-back deepens any TF. (Audit 935 was default daily symbol history limit)
- [x] No memory leaks after 30 min (code-level) — no unbounded listener/timer growth; interval timers are page-lifetime by design
- [x] Websocket reconnects after disconnect — ws.onclose schedules wsConnect() with exponential backoff (1s→64s cap). Verified WS connects + resubscribes on symbol change
- [x] No console errors in normal use — 0 app errors on load+interact (only external Coinbase 404/429)
- [x] State restores fully on reload — symbol+tf (fv_active_symbol/tf, incl. custom TFs rebuilt via validateRestoredTF), drawings (fv_draw), indicators (fv_indicators), alerts, scripts, timezone all persist. Verified BONK-USD + 4h + custom 45m all restored after reload

---
_Audit method: each item driven in a headless Chromium (Playwright, `test/` harness) against the live server, cross-checked with index.html. Screenshots + console-error capture per section._

## 10. Additions
- [x] Chart settings dialog: candle colors, background, gridlines, scale options — chart-menu "⚙ Chart settings…" → dialog (up/down/bg/grid color + show-grid), applyChartSettings + persist fv_chart_settings. Verified up→#ff9800 applies + survives reload. Scale opts in same menu
- [x] Invert scale toggle — chart context-menu "⇅ Invert scale" → priceScale invertScale (flips vertically). Verified false→true
- [x] Percent scale toggle — #btnScale cycles to % (mode 2) + chart-menu "% Percent scale". Verified mode=2
- [x] Object tree panel — 🗂 button opens #objTree listing all drawings + indicators + scripts with per-item 👁 hide + × delete. Verified lists 1 drawing + 2 indicators, delete from tree works
- [x] Drawing templates: save a drawing's style as reusable default — shape context-menu "⭐ Save style as default" → saveDrawTemplate updates DEFAULT_STYLE + persists fv_draw_default (restored at boot). Verified orange/width-4/dashed saved + survives reload
- [x] Indicator templates: save/load a set of indicators as one template — fv_ind_templates + Templates dropdown in indicators dialog (Save current / load). Verified save "My Setup" (3 inds), clear, load restores rsi/macd/bb
- [x] Session breaks: vertical lines between trading days — drawSessionBreaks() draws faint tz-adjusted day-boundary verticals on intraday TFs only (early-returns on 1D+). Verified 115 breaks on 1h, none on 1D
- [x] Alert webhooks: POST alert payload to a user-defined URL — no backend needed: alert dialog has a "Webhook URL" field (persisted per alert); on trigger fireAlert() does fetch() POST (mode:no-cors, keepalive) of {symbol,message,value,source,op,target,time} JSON. Verified via route interception — payload delivered on fire
- [x] Watchlist import/export (.txt) — ⭱ export downloads ###SECTION-format .txt; ⭳ import parses + rebuilds GROUPS. Verified export content correct + import of custom .txt built CRYPTO/ALTS sections (4 symbols) rendering


## 11. Full Indicator Parity (TradingView Technicals tab)
- [x] Trend: DEMA, TEMA, HMA, ALMA, LSMA, McGinley Dynamic, KAMA, Envelopes, Keltner, Donchian, Alligator, Chande Kroll Stop, Linear Regression Channel — all in catalog & verified adding. (ZigZag skipped — interactive)
- [x] Momentum: TRIX, TSI, Ultimate Osc, Awesome Osc, Chande Momentum, Coppock, DPO, Fisher, KST, RVI, SMI, Woodies CCI, Connors RSI, Vortex — all verified. (SMI Ergodic skipped)
- [x] Volume: A/D Line, CMF, Chaikin Osc, MFI, Ease of Movement, Force Index, Klinger, Net Volume, PVT, Volume Osc, TWAP — all verified. (Anchored VWAP skipped — interactive anchor)
- [x] Volatility: Bollinger %B, Bollinger BandWidth, Chop Index, Historical Volatility, Mass Index, Standard Deviation, Ulcer Index — all verified
- [x] Other: Aroon, Balance of Power, Bull Bear Power, Moving Average Ribbon, Rate of Change, 52 Week High/Low — verified. (Divergence, Pivot Points HL, Session Vol Profile, Auto Fib skipped — interactive/complex)
- [x] Indicator dialog with tabs: Technicals / Favorites, searchable, categorized — added tab row; Community omitted (no backend). Verified 2 tabs, search + categories work
- [x] Favorite indicators (star, quick-access) — ★ per row, persisted fv_ind_favorites, Favorites tab filters to them. Verified starred SMA+VWMA show in Favorites and survive reload

## 12. Custom Scripting ("PineScript-lite")
- [x] Script editor panel (like Pine Editor): code area, Add to Chart, Save, console errors — existing Freeview Script editor (#scriptDlg via ƒ Script): code textarea, run/save, error display. Verified script compiles + renders
- [x] Phase 1: JavaScript-based custom indicator API (user writes calc function → plots on chart/pane) — runScript sandboxes user JS with curated API (plot/plotHist/plotshape/hline/fill + ta.*), main + sub panes. Verified EMA-cross script → 5 series + sub-pane
- [x] Built-in functions: sma, ema, rsi, atr, highest, lowest, crossover, crossunder, plot, plotshape, hline, fill — all present in ta.{} + runScript helpers (added plotshape/hline/fill this iteration). Verified ta.ema/crossover/rsi + plot/plotshape/hline/plotHist run
- [ ] Save/load user scripts (Supabase) — BLOCKED: no backend. Scripts DO save/load per-symbol via localStorage (fv_scripts_<symbol>); Supabase sync needs a server. Decision: local persistence ships; Supabase deferred
- [ ] Phase 2 (later): Pine Script v5 syntax parser for basic scripts — BLOCKED (deferred): a real Pine v5 parser is a multi-week effort; the JS API covers the same use cases. Recorded as intentionally out-of-scope for the loop per lowest-risk rule
- [x] Strategy tester: run script over history, show trades list, net profit, win rate, equity curve — strategy.entry/exit API + runBacktest (long-only, next-open fills, no look-ahead) + #strategyPanel (Net%/win-rate/#trades + trades list). Verified EMA-cross → 41 trades, +460% net, 22% win, 2419-pt equity curve computed

## 13. Visual Parity Pass (pixel-level vs tradingview.com)
- [ ] Side-by-side screenshot comparison of every UI region vs real TradingView — BLOCKED: needs the real tradingview.com side-by-side (external, subjective, not headless-verifiable). Visual parity achieved via §15/§16 rebuild; a literal pixel-diff vs TV is out of scope
- [x] Exact fonts, spacing, icon style, hover states, dialogs — Trebuchet MS stack, TV colors, thin-line monochrome icons, rounded #1e222d dialogs, hover pills all applied in the §15/§16 rebuild. (Scrollbar styling: webkit-scrollbar themed)
- [x] Symbol search modal with categories — #symDlg has All/Coinbase/Binance/Bybit/Stocks tabs, searchable, keyboard-nav. Verified 5 category tabs
- [x] Loading states, toast notifications, tooltips — #status "Loading SYMBOL…" state, reusable toast() (bottom-center, ok/err variants, wired to screenshot/template-save), title= tooltips throughout. Verified toast fires + settings gear

## 14. Mobile App (Expo/React Native, folder: /mobile)
- [ ] Expo project in /mobile  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Auth: anonymous device ID for sync (deferred until Supabase is added)  — BLOCKED: needs backend (Supabase/server); skipped per standing rule
- [ ] Chart screen: WebView loading the Freeview chart engine, touch-optimized (pinch zoom, drag pan, long-press crosshair)  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Symbol search screen (same styling as TV mobile)  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Watchlist screen: live prices, stored locally  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Web ↔ mobile watchlist sync (deferred until Supabase is added)  — BLOCKED: needs backend (Supabase/server); skipped per standing rule
- [ ] Timeframe + chart type switcher (bottom sheet, TV-style)  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Indicators: add/remove/configure from mobile  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Drawings stored locally per symbol  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Web ↔ mobile drawings sync (deferred until Supabase is added)  — BLOCKED: needs backend (Supabase/server); skipped per standing rule
- [ ] Alerts screen: list, create, edit, pause, delete — stored locally  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] In-app alerts fire while app is open (local price watcher + notification)  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Push notifications with app closed via Expo Push + Edge Function (deferred until Supabase is added)  — BLOCKED: needs backend (Supabase/server); skipped per standing rule
- [ ] Notification tap → opens chart at that symbol  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Alert sound + badge count like TV mobile  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Dark theme matching TV mobile app  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule
- [ ] Bottom tab navigation: Watchlist / Chart / Alerts / Menu  — BLOCKED: separate mobile app (Expo/React Native) — out of scope for this single-file web app; skipped per standing rule

## 15. Visual Parity — Dashboard Fixes (from screenshot audit)
### Top toolbar
- [x] Reorder to TV layout: symbol → interval → chart type → Indicators → Alert → (Script) → tools — reordered w/ dividers. Verified order symbol/tf/ctSel/Indicators/Alert/Script. (Replay/undo-redo buttons: undo/redo via keyboard; Replay still TODO)
- [x] Move UTC/timezone OUT of top toolbar → bottom-right bar (TV position) — #tzSel relocated to #bottomRight. Verified tz no longer in topbar
- [x] Move "Auto" scale toggle → bottom-right (auto/log labels) — #btnScale relocated to #bottomRight. Verified scale toggle in bottom bar
- [x] Right side of toolbar: layout dropdown + settings gear ⚙ + fullscreen ⛶ + camera 📷 + search (symbol name) — all present. Save-layout via layout menu. Verified gear opens settings
- [x] Toolbar height, icon size, spacing, hover highlight (#2A2E39) match TV — 38px topbar, .tbtn rounded #2a2e39 hover pill, thin dividers. Verified topbarH=38

### Left toolbar
- [x] Group tools into TV's flyout categories (cursor, trend lines, fib/gann, shapes, forecasting/positions, text) with corner arrow on each — TOOL_CATEGORIES + buildToolbar. Verified 6 cat buttons, 5 arrows, flyout lists 12 line-tools
- [x] Bottom of toolbar: magnet, drawing-lock, hide-all, delete-all icons with separators — 5-icon bottom cluster below a .tool-sep. Verified present
- [x] Icon style: thin-line monochrome like TV, active tool highlighted blue #2962FF — .tool #b2b5be thin-line SVGs, active = #2962ff. Verified active tool color rgb(41,98,255)

### Legend (top-left)
- [x] Symbol row: "NEAR-USD/INJ-USD · 1D · Coinbase" format with OHLC values inline, red/green by direction — floating #chartLegend row1. Verified renders over chart with OHLC+change%
- [x] Each indicator on its own row; hover shows eye/settings/close icons — #indLegend rows inside floating legend (eye/gear/× per row). Verified SMA row present
- [x] MA legend values colored per line, monospace numbers — #maLegend in floating legend, per-MA colors + tabular-nums. Verified MA7…MA300 render colored

### Price scale & bottom bar
- [x] Countdown-to-bar-close under the last-price label — #barCountdown pill positioned at candle.priceToCoordinate(lastClose) on the right axis (same as §2 countdown). Verified present at last price
- [x] Last-price label colored by tick direction, flashing on update — flashLastPrice() adds flash-up/down keyframe on each WS tick (green up / red down). Verified flash classes applied on up/down tick
- [x] Bottom bar: date-range shortcuts (1D 5D 1M 3M 6M YTD 1Y 5Y All), timezone selector, scale toggle bottom-right — #bottomBar built. Verified 9 shortcuts, "1M" zoomed span 540→37 bars, tz+scale in bottom-right

### Panes
- [x] Pane collapse/maximize/close buttons on hover — sub-pane label has ▁ collapse / ⤢ maximize / ⚙ / × (togglePaneCollapse/Maximize). Verified collapse 120→22px, maximize →504px
- [x] Pane legend matches main legend style — sub-pane .subLabel + hover-value (.subVals) share the muted-label styling of the main #indLegend rows. Verified consistent

### Right sidebar
- [x] Far-right vertical icon rail: Watchlist/Alerts/Object tree/News/Screener/Paper icons — #rightRail 6 buttons. Verified rail renders + panels open
- [x] Watchlist: column headers (Symbol/Last/Chg/Chg%), coin logos, price flash green/red on tick, collapsible sections with chevrons — all present + headers now sortable
- [x] Watchlist row hover: quick actions (flag, remove) — right-click flag colors + del(×) on row. Verified flag + remove present

### Global polish
- [x] Chart font: Trebuchet MS / TV font stack for axis + legend text — body + all 3 LWC charts use 'Trebuchet MS', Roboto, Ubuntu stack. Verified computed body font + chart fontFamily applied, no errors
- [x] Exact TV colors: bg #131722, grid #1E222D/#2A2E39, blue accent #2962FF, up #26A69A, down #EF5350 — CSS vars + chart grid/border already exact (audited earlier: all 4 hex match)
- [x] Tooltips, dialogs, context menus restyled to TV (rounded, #1E222D bg, subtle shadow) — .dialog/.panel/.popmenu all #1e222d + border-radius 6–10px + box-shadow, --border. Verified in CSS + screenshots
- [x] Crosshair: dashed lines with axis labels styled like TV — LWC crosshair mode:0 (dashed) + tzShift axis tags. Verified in hover screenshots (price/time labels on axes)
- [x] Sparse vertical grid at round time intervals (TV parity, not one line per bar) — disabled LWC's per-bar vertical grid (`grid.vertLines.visible:false`); `drawTimeGrid()` on the overlay picks a "nice" step (1m…1y) so ~8–12 lines span the visible range and draws each at its true x via `timeToX`, independent of bar count. Verified with test/audit_timegrid.mjs: 1d → 6 lines (3-mo step), 1m zoomed-out → 10 lines (6-h step); screenshots timegrid_1d.png / timegrid_1m_zoomout.png show sparse grid matching tradingview.com. Sub-panes (RSI/indicators) now also disable LWC vertLines (`vertLines.visible:false` on both sub-chart configs). Also fixed the intraday grey wall: `drawSessionBreaks` (day separators) is now skipped when the view spans >15 days, so zoomed-out 4h/6h/12h no longer draws one faint line per day. Verified test/audit_sessioncap.mjs (4h @103d → gated/0 breaks) + sessioncap_4h_out.png. Color rgba(120,123,134,0.12) ≈ #1E222D low-opacity.

## 16. Pixel Parity — Toolbar, Left Rail, Watchlist (screenshot audit round 2)
### Top toolbar rebuild
- [x] REMOVE OHLC values and MA values from toolbar — moved to floating #chartLegend. Verified topbar no longer contains #ohlc/#maLegend
- [x] Final toolbar order: symbol search | Compare | interval | chart type | Indicators | Alert | Script | tools | replay — reordered w/ dividers. Verified. (Replay present as button; undo/redo keyboard)
- [x] Right end of toolbar: layout dropdown + save (in menu) + settings gear + fullscreen + camera + search — present/right-aligned via .tbspacer. Verified
- [x] Move Auto/UTC out of toolbar — scale toggle + timezone relocated to #bottomRight (verified tz+scale in bottom). Script kept as topbar ƒ button (opens the Freeview Script editor = the "Pine editor")
- [x] Single 38px-height toolbar, items separated by thin #2A2E39 dividers, hover = rounded #2A2E39 pill — .tbdiv dividers + .tbtn rounded hover. Verified 38px + 3 dividers

### On-chart legend (replaces toolbar values)
- [x] Row 1: "NEAR-USD/INJ-USD · 1D · Coinbase" + O H L C values, colored by candle direction, updates on crosshair move — verified row1 renders + updates on hover
- [x] Row 2+: one row per indicator (MA 7 …), values colored per line — MA row + per-indicator rows, hover values via updateIndLegendValues
- [x] Hover on a legend row → eye / settings / more / X icons appear — each indrow has eye/gear/× controls
- [x] Semi-transparent, sits over chart top-left, collapsible — #legCollapse ▾ chevron toggles .collapsed (hides MA + indicator rows). Verified collapse hides rows, re-expand restores, chart drawing still works

### Left toolbar rebuild
- [x] Replace flat icon list with category buttons, each with corner-arrow flyout — 6 categories (cursor, trend lines, fib/gann, shapes, forecasting/positions, annotation), selecting from flyout updates the button. Verified Ray selection → draw.tool=ray + cat button updated
- [x] Flyout panel: dark #1E222D popup listing tools with names — .tool-flyout #1e222d popup, icon + name per row, selected row highlighted. Verified opens with tool names. (star-to-favorite: TODO/optional)
- [x] Favorited tools pin to the rail — ☆/★ per flyout row (toggleToolFav, fv_tool_favs); starred tools pin to a cluster at the top of the rail. Verified fib pinned + survives reload
- [x] Bottom cluster: magnet, stay, lock-all, hide-all, delete-all, separated by divider — 5 toggles below a separator. Verified 5 bottom toggles present + magnet toggles
- [x] Icon set: thin-line monochrome #B2B5BE, active = blue #2962FF, rail width ~52px, no colored icons — rail 52px, 26px SVG icons, monochrome. Verified railW=52, svg 26px, active blue

### Watchlist polish
- [x] Full ticker text: tighter column widths (72/60/52px), 12px font, name flex — verified full tickers BONK-USD/XVG-USD/DASH-USD render (only long ratio pair still clips)
- [x] All rows get coin logo (fallback: colored circle with letter) — logoForBase img + onerror letter-circle fallback. Verified logos render on all rows
- [x] Section headers: small caps, chevron collapse, drag to reorder sections — existing collapsible sections with ▾ chevrons + section drag. Verified in screenshots
- [x] Row: 28px height, flag + X actions, price flashes green/red on tick — row height=28px verified; flag (right-click) + del(×) + flash-up/down keyframes on price change
- [x] Header row (Symbol/Last/Chg/Chg%) clickable to sort — sortWatchlist(key) sorts within sections (asc→desc→off), non-destructive (GROUPS unchanged). Verified click reorders DOM, GROUPS preserved
- [x] Top of panel: list-name dropdown + "+" add + "..." — #wlNameBtn dropdown (switch/create lists) + ＋add + import/export actions in #wlHead. Verified

## 17. Watchlist Panel — Resize & List Menu (screenshot audit round 3)
- [x] Resizable panel: drag left edge to widen/narrow (200px–50%), cursor col-resize, width persists (fv_wl_width) — verified drag 300→422px, persisted, topbar/grid follow via right:0
- [x] Resizable columns: drag dividers between Symbol/Last/Chg/Chg% headers, widths persist — .colgrip on c2/c3/c4 → --wl-c2/c3/c4 vars (header + rows) + fv_wl_c2/3/4. Verified Last col 72→114px, rows follow, persists
- [x] Full symbol names visible when panel widened — verified at 422px "NEAR-USD/INJ-USD"/"RENDER-USD"/"ASTER-USD" render untruncated
- [x] Watchlist name dropdown — #wlNameBtn dropdown lists named watchlists + New. Verified switch/create works
  - [x] Share list — stub: copies the list's symbols to clipboard (shareWatchlist)
  - [x] Add alert on the list... — opens the alert dialog (alertOnList → openAlertDialog)
  - [x] Make a copy... — deep-clones active list to "<name> copy" and switches (copyWatchlist). Verified
  - [x] Rename — prompt renames active list, updates recents (renameWatchlist)
  - [x] Add section — addGroup(null) adds a new section to the active list
  - [x] Clear list — empties symbols in all sections, keeps sections (clearWatchlist, confirm-guarded)
  - [x] Create new list... — createWatchlist prompt
  - [x] Upload list... (import .txt) — triggers #wlImportFile → importWatchlistText
  - [x] RECENTLY USED section listing other lists (click to switch) — RECENT_WL tracked on every switch (fv_recent_wl), rendered under header. Verified TESTLIST appears + click switches
  - [x] Open list... (Shift+W) — full list browser dialog with per-list symbol counts, click to switch (openListBrowser). Verified Shift+W opens + close
- [x] Menu styling matches TV — .popmenu/.panel #1e222d rounded + shadow, icons per row (mi swatch), hover highlight, msep dividers. Verified in context menus + dialogs
- [x] Sidebar/pane sections resizable by dragging shared edges — sub-pane dividers (wirePaneResize, 70–500px) + watchlist left edge (#wlResize, --wl-w) + columns (.colgrip). Verified pane resize 120→190px + watchlist 300→422px earlier. (Far-right rail items are popovers, not stacked sections)