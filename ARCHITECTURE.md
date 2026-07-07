# Freeview — Architecture

## 1. Overview

Freeview is a free, keyless, single-file TradingView-style crypto chart. It is entirely client-side: no build step, no backend, no API key, no paywall. The entry point is `index.html`; opening it directly from disk (`file://`) or from a static server is equivalent.

**Origin:** the app was written to chart the synthetic **NEAR-USD / INJ-USD ratio** that TradingView locks behind its Premium subscription. Any spread `A/B` is computed live by aligning both legs' candles and dividing OHLC component-wise.

**Engine choice:** [Lightweight Charts 4.1.3](https://github.com/tradingview/lightweight-charts) (Apache-2.0, freely redistributable). TradingView's official Charting Library requires a per-application licence and cannot back a "free for anyone" app; Lightweight Charts has no such restriction. The library is loaded as a standalone UMD bundle from the unpkg CDN:

```html
<script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
```

There is **no build step** and **no backend**. All data comes from public exchange APIs and, for Yahoo Finance, through a client-side CORS proxy chain.

---

## 2. File Layout

Everything lives in **`index.html`** (~4380 lines). The file is three sections in order:

| Section | Lines (approx.) | Contents |
|---|---|---|
| `<style>` | 1–282 | All CSS: dark-theme variables, layout (flex #app), toolbar, topbar, watchlist, dialogs, sub-panes, indicator legend, context menu, alert dialog, add-symbol dialog |
| HTML skeleton | 283–344 | `<body>` tree: `#toolbar` (left drawing bar), `#main` > `#topbar` + `#chartWrap`/`#chart`/`#draw` + `#rsiWrap`/`#rsi` + `#subPanes`, floating UI (`#ctxMenu`, `#indicatorsMenu`, `#alertsPanel`, `#settingsDlg`, `#alertDlg`, `#scriptDlg`, `#symDlg`, `#dlgBackdrop`), `#watchlist` |
| `<script>` | 345–4356 | The entire application: data layer, render layer, drawing engine, indicators, Freeview Script, alerts, watchlist, persistence, boot |

### Supporting documents

| File | Purpose |
|---|---|
| `README.md` | User-facing quick-start, feature list, known limitations |
| `AUDIT.md` | Feature-gap audit (Freeview vs TradingView), build-wave roadmap |
| `tasks/` | Per-wave implementation notes |
| `CLAUDE.md` | AI-session memory (architecture pointers, gotchas) |

---

## 3. Data Layer

### Exchange routing

A watchlist entry is called a **leg**. The routing key is an exchange prefix:

| Leg form | Exchange | Market |
|---|---|---|
| `BTC-USD` (no prefix) | Coinbase spot | Default; backward-compatible |
| `BINANCE:BTCUSDT` | Binance spot | `api.binance.com/api/v3` |
| `BINANCE:BTCUSDT.P` | Binance USDⓈ-M perp | `fapi.binance.com/fapi/v1` |
| `BYBIT:BTCUSDT` | Bybit spot | `api.bybit.com/v5/market/kline` |
| `BYBIT:BTCUSDT.P` | Bybit linear perp | same, `category=linear` |
| `YF:AAPL` | Yahoo Finance | stocks, ETFs, forex, metals, indices |

`resolveLeg(leg)` parses the prefix and returns `{exchange, rest, isPerp, leg}`. Helper functions `legBase()` and `legShort()` derive the base ticker and display label.

Coinbase and Binance/Bybit send permissive CORS headers, so the browser fetches them directly. Yahoo Finance does not; those calls are relayed through `proxyJSON()`.

### CORS proxy chain

`CORS_PROXIES` is an ordered array of three free relay functions (allorigins, corsproxy.io, thingproxy). `proxyJSON(url)` attempts each proxy, parses the response body as JSON (rejecting HTML error pages), and retries all three a second time after a 500 ms pause before giving up. Used only for Yahoo Finance calls.

### Timeframe config — `TF`

```
TF[key] = { label, menu, sec, base, bucket, pages }
```

**Custom timeframes.** The tf menu has a text input (`#tfCustom`). `parseCustomTF("45m"|"3h"|"10d"|…)` accepts m/h/d/w (bare number = minutes), clamps to 1m–4w, and picks the largest native base in `TF_BASES` (86400/21600/3600/900/300/60) that evenly divides the requested bucket. `applyCustomTF` lazily inserts a `TF["c<sec>"]` entry (section `CUSTOM`, e.g. `c2700` for 45m) and selects it, so aggregate() rolls the base bars up to the custom bucket like any built-in TF.

**Timezone selector.** Topbar dropdown `#tzSel` built from `TIMEZONES` (UTC/Exchange/NY/London/Berlin/Dubai/Tokyo/Sydney/Local). `tzOffsetMin` (minutes east of UTC) is applied by `tzShift(ms)`, which nudges the UNIX time so downstream `getUTC*` reads yield the selected zone's wall clock. Both `tickLabel` (axis) and `crosshairTimeFmt` (crosshair bottom tag, via `localization.timeFormatter`) route through it. `applyTz` re-applies the formatters to every pane in `charts` and persists to `localStorage["fv_tz"]`. Offsets are fixed (no DST math) — approximate, matching how the labels read on a 24/7 crypto chart; trading "sessions" don't apply to crypto so only the timezone half is implemented.

**Bar-close countdown.** `#barCountdown` is a pill on the right price axis showing time until the current bar closes, TradingView-style. `updateCountdown()` (1s interval) computes the next epoch-aligned bucket boundary `(floor(now/step)+1)*step`, formats via `fmtCountdown` (d/h, h:mm:ss, or m:ss), and positions the pill at `candle.priceToCoordinate(lastClose)`. Hidden when there's no data or the price is off-screen.

| Key | `base` (sec fetched) | `bucket` (sec per bar) | `pages` |
|---|---|---|---|
| `1m` | 60 | 60 | 26 |
| `5m` | 300 | 300 | 36 |
| `15m` | 900 | 900 | 18 |
| `30m` | 900 | 1800 | 18 |
| `1h` | 3600 | 3600 | 36 |
| `2h` | 3600 | 7200 | 36 |
| `4h` | 3600 | 14400 | 36 |
| `6h` | 21600 | 21600 | 20 |
| `12h` | 21600 | 43200 | 20 |
| `1d` | 86400 | 86400 | 9 |
| `1w` | 86400 | 604800 | 9 |
| `2w` | 86400 | 1209600 | 9 |
| `1M` | 86400 | 2592000 | 9 |
| `1Y` | 86400 | 31536000 | 9 |

The `pages` field is legacy — the progressive loader no longer uses it for depth. Depth is now driven by a global `MAX_BARS = 50000` ceiling (see below); `pages` is only kept as a default on custom-TF entries.

`base` is the native granularity actually fetched from the exchange. When `bucket > base` (2h, 4h, 12h, 1w, 2w, 1M, 1Y, 30m), `aggregate()` rolls up the base bars into fixed epoch-aligned buckets. `1M` (month, 30d) and `1Y` (year, 365d) are epoch-aligned like `1w` — not calendar-month/year boundaries. `1M` (month) is a distinct key from `1m` (minute); the map is case-sensitive.

### Per-exchange page fetchers

Each normalises its exchange's payload to the common shape `{time(sec), low, high, open, close, volume}`:

- **`fetchPageCoinbase(product, g, span, end)`** — Coinbase `[time, low, high, open, close, vol]` array, up to 300 bars, times already in seconds.
- **`fetchPageBinance(rest, g, span, end, isPerp)`** — Binance kline array, up to 1000 bars, `openTime` converted from ms to seconds.
- **`fetchPageBybit(rest, g, span, end, isPerp)`** — Bybit v5 `result.list`, up to 1000 bars, `start` converted from ms to seconds.
- **`fetchPageYahoo(sym, g, end)`** — Yahoo v8 chart endpoint; returns the full series in one call (no pagination cursor); null gaps (holidays/halts) are skipped. Routed through `proxyJSON`.

`fetchPage(leg, g, span, end)` dispatches to the correct fetcher based on `resolveLeg`.

### Progressive loader — `fetchKlinesProgressive`

Paginates backward through history, calling `onPage(barsSoFar)` after each page while history deepens. Each page's oldest timestamp drives the next `end` parameter. A page shorter than 66% of the maximum page size signals the start of history; the loop stops early. Coinbase caps at 300 bars/page; Binance/Bybit at 1000.

**The caller paints the first page only, then once at the end — not per page.** A Coinbase intraday TF can stream ~168 pages (50k ÷ 300); painting each fired ~168 full re-renders (candle + 6 MAs + RSI), freezing the UI ~20s on a timeframe switch and tripping the same Lightweight Charts null-race that wedges the chart (so the switch appeared to do nothing). `loadChart`'s `paintProgressive` renders only the first page (instant switch + snap to latest); the loop's trailing `paint(data)` renders the complete series once. Between them, history keeps deepening without repainting. See `test/regression_tf_switch.mjs`. **The first-page paint is suppressed entirely on a `keepView` load** (`_painted` starts at 1 when `paintedFromCache || keepView`): the silent 20-second background refresh (`setInterval(loadChart(sym, tf, true), 20000)`) must never disturb the user's view, so it paints only the final complete series — painting a partial first page would momentarily shrink the series and jolt a zoomed/panned chart (the "bounces and goes blank for ~2 s out of nowhere" symptom). See `test/regression_zoom_refresh.mjs`.

**50k-bar ceiling, but eager fetch is capped.** Every timeframe can *eventually* be viewed back up to `MAX_BARS = 50000` candles, but a fresh load no longer eagerly fetches all ~334 pages needed for that depth. Fetching the full depth on every TF switch cost seconds and hammered Coinbase's public candles endpoint into **HTTP 429**, which fell through to `[]` and looked like a hang (the reported "takes too long to load the timeframe"). `fetchKlinesProgressive` now caps the eager load to `initialPages` — enough raw bars for ~2000 output candles (fills the initial ~420-bar view plus scrollback headroom) — and relies on `loadOlderHistory` (infinite scroll-back) to deepen the rest on demand. `fullPages` (the old `MAX_BARS`-derived count) is the ceiling `initialPages` is clamped to. `fetchPageCoinbase` also retries 429/5xx with backoff so the **first** page reliably lands. `finalizeBars` trims to the newest 50k. See `test/repro_realistic.mjs`, `test/repro_coldpaint.mjs`.

**Instant re-switch (series cache).** `loadChart` keeps a bounded LRU `_seriesCache` (`"SYM|tf"` → finalized bar array, max 40 entries) written on every successful full fetch. On a non-`keepView` load, if the symbol+tf is cached it paints that series **synchronously** before touching the network (`paintedFromCache`), so revisiting any previously-viewed TF is instant (~1 ms). The network refresh still runs in the background; when painted from cache, the first-page progressive paint is skipped (it would shrink the visible history) and the final paint uses `keepView` so it doesn't yank the user's view. See `test/repro_realistic.mjs`.

`fetchKlines(product, tfKey)` is a non-progressive wrapper (no `onPage` callback) for callers that want the full result.

### Data pipeline — `finalizeBars`

After each page and at completion:

1. **Dedupe** — drop bars with duplicate `time` values.
2. **Sort** oldest-first.
3. **`sanitize`** (Hampel bad-print wick clamp) — for each bar, compute the local-median wick of its ±10 neighbors; clamp any wick exceeding 4× that median (with a 15% floor). Removes exchange bad-prints (e.g. INJ's bogus 14.75 high on 2025-11-08) that would otherwise create fake spikes in ratio charts.
4. **`aggregate`** — group bars into `bucket`-second epoch-aligned buckets; OHLC and volume are accumulated correctly per bucket.

### Ratio/spread — `makeRatio`

For a symbol `A/B`, both legs are fetched in parallel via `fetchKlinesProgressive`. `makeRatio(a, b)` aligns bars by timestamp and divides component-wise:

```
open  = A.open  / B.open
close = A.close / B.close
high  = A.high  / B.high     (then envelope to include open/close)
low   = A.low   / B.low      (then envelope to include open/close)
```

This matches TradingView's ratio convention. Cross-term division (e.g. A.high/B.low) is deliberately avoided as it produces artificially inflated wicks.

**Spread symbols paint the first combined page, then once at the end.** Like single symbols, a spread paints the **first combined page** as soon as both legs have their first page (`tryFirstPaint` → `paintProgressive(makeRatio(...))`, guarded to fire only once), then renders the complete series once after **both** legs fully load. This makes a spread TF switch feel instant (~270 ms to first paint) instead of blank until every page of both legs finished (~3–4.5 s), which read as "the TF change hangs". Crucially it still paints only **twice** (first + final), never per page: per-page repainting fires dozens of full re-renders (candle + 6 MAs + RSI) back-to-back while `makeRatio` runs on partial, misaligned legs, and on a wide-range ratio (NEAR/INJ spans ~0.06–2.6) that thrash trips an **intermittent Lightweight Charts race** — `Error: Value is null` in the line renderer during an animation frame — which permanently **freezes the chart's render + time-scale pipeline** (blank candles, "bouncing" zoom that never settles). The final paint yields the correct bar count (the true leg overlap, e.g. NEAR/INJ = 2022-09-20→present). See `test/regression_chart_render.mjs` and `test/verify_spread_paint.mjs`.

### Yahoo Finance stats

`fetchStatsYahoo(sym)` fetches a 5-day 1d chart and reads `meta.regularMarketPrice` (last) and `meta.chartPreviousClose` (open) for watchlist price display.

---

## 4. Rendering Layer

### Chart instances

| Instance | Element | Purpose |
|---|---|---|
| `chart` | `#chart` | Main candle chart + editable MAs (`MAS`: type/period/source/color/width/style, gear-editable, persisted in `localStorage["fv_mas"]`) + aux series |
| `rsiChart` | `#rsi` | RSI panel (always visible). Right-click **Settings** (`openRsiSettings`) opens the SAME TradingView-style **Inputs / Style / Visibility** tabbed dashboard as the dynamic indicators. It edits `RSI_PARAMS {len, src, divergence, smooth, maType, bbStdDev, waitClose, style{…}}`. **Inputs** has full TradingView parity: RSI Length + **Source** (`rsiSeries(data,len,src)` honors it), **Calculate Divergence** (`rsiDivergenceMarkers` marks regular bull/bear pivots on `rsiLine`), a SMOOTHING section with **Type** (SMA/EMA/WMA/RMA/VWMA/Bollinger Bands via `rsiSmoothMA`) + Length + **BB StdDev** (enabled only for the BB type), and a CALCULATION section (Timeframe/Wait-for-closes, shown but inert — the app always uses the chart TF + closed bars). **Style/Visibility** = per-plot color + width + line-style + show/hide for the RSI line, RSI-based MA, and 70/50/30 bands. `applyRsiStyle()` pushes the style onto the 5 live series (`rsiLine`/`rsiMa`/`band70`/`band50`/`band30`) and runs at boot so persisted looks restore; persisted in `localStorage["fv_rsi_params"]`; `updateRsiLabel()` keeps the `#rsiName` header in sync |
| `ind.subChart` (per indicator) | `.subpane` in `#subPanes` | Dynamically created for sub-pane indicators |
| `sc.subChart` (per script) | `.subpane` in `#subPanes` | Dynamically created for script sub-pane plots |

All chart instances share `common` options (dark background, grid, `PRICE_AXIS_W = 72` px right-axis gutter, `handleScroll:false`, `handleScale:false` — pan/zoom are handled manually on the overlay canvas).

### Main chart series

- `candle` — `CandlestickSeries`; the canonical OHLC and coordinate anchor. `autoscaleInfoProvider` pins the scale to `manualPriceRange` when set.
- `maSeries[0..5]` — six `LineSeries` for MA 7/25/99/150/200/300 (orange/red/green/cyan/magenta/white).
- `aux{}` — lazily created auxiliary series keyed by chart type (`line`, `linemark`, `step`, `area`, `baseline`, `bars`, `hlcbars`, `columns`, `highlow`, `renko`, `kagi`, `pnf`, `linebreak`) for non-candle chart styles.

### `renderData(data, keepView)`

The central paint function. Called on each progressive page and at completion:

0. **Time-order guard.** Lightweight Charts requires strictly-ascending, unique bar times; a single out-of-order or duplicate `time` trips its internal `Value is null` render race (which permanently wedges the chart, most visibly during rapid zoom-out). Since spread ratios and history-prepend merges can occasionally emit a misordered bar, `renderData` first checks ascending order and, only if violated, sorts by time and drops duplicate-time bars — at this one chokepoint every paint path routes through. See `test/regression_chart_render.mjs` check [1].
1. Sets `lastData = data`.
2. Calls `applyChartType(data)` — routes into the active chart style (see below).
3. Calls `redraw()` to repaint the drawing overlay.
4. Computes and sets six MA series via `smaSeries`.
5. Computes RSI(14) and its 14-bar MA via `rsiSeries` / `maOfSeries`; re-keys both onto the full `data` timeline using `fullSeries` (whitespace padding) so RSI bars stay index-aligned with candles in the synced logical range.
6. Calls `renderAllIndicators()`, `renderAllScripts()`, `checkAlerts()`.
7. If `!keepView && _autoSnap`, snaps the visible range to the latest ~420 bars plus ~35% future whitespace.
8. Calls `alignPriceAxes()` (deferred via `setTimeout(0)`) to equalise right-axis gutter widths.

### Chart types — `applyChartType`

Controlled by `chartType` (string: `candles|hollow|heikin|bars|hlcbars|line|linemark|step|area|baseline|columns|highlow|renko|kagi|pnf|linebreak`). `setChartType(t)` updates it and calls `applyChartType`.

- **candles** — `candle` visible with raw data.
- **hollow** — `candle` visible with `hollowData(data)` (per-bar color `rgba(0,0,0,0)` body when close≥open; colored by close vs previous close).
- **heikin** — `candle` visible with `heikinAshi(data)` transform.
- **bars / hlcbars** — bar series; `hlcbars` sets `openVisible:false` to hide the open tick.
- **line / linemark / step** — line series; `linemark` adds `pointMarkersVisible`, `step` uses `lineType:1` (WithSteps).
- **area / baseline** — area / baseline series; baseline anchors at `data[0].close`.
- **columns** — histogram series, per-bar green/red vs previous close.
- **highlow** — bar series with both ticks hidden, drawn low→high per period.
- **renko / kagi / pnf / linebreak** — price-transform styles rendered through a dedicated candlestick aux series fed by `renkoData` / `kagiData` / `pnfData` / `lineBreakData`. These rebuild bars from price *movement* (box size from `boxStep` = 0.75× median bar range), so emitted bricks/legs borrow the source bar's timestamp (nudged +1s via `tsPusher` to stay strictly ascending). On these four, the time-based MA overlays are hidden (`maSeries … visible:false`) and `chart.timeScale().fitContent()` re-fits the view, since the transformed series no longer aligns to the calendar time axis.

For non-candle styles the `candle` series is hidden but still set with the raw data so coordinate helpers, crosshair, and drawings remain valid (except the transform styles, which fit to their own series).

Scale modes (0 Normal / 1 Log / 2 Percent) are set via `setScaleMode(m)` which calls `chart.priceScale("right").applyOptions({mode:m})`.

### Future whitespace — `futureWhitespace` / `withFuture` / `FUTURE_DAYS`

`FUTURE_DAYS = 120`. Every series (candles, MAs, RSI, indicators, scripts) is padded with whitespace bars (`{time}` only — no OHLC) so the time scale, grid lines, date-axis labels, and drawings extend past the last real bar. The future extent is `max(FUTURE_DAYS·86400, step·6)` — normally ~4 months, but for coarse timeframes whose bucket exceeds 120 days (`1M`, `1Y`) it extends to ≥6 bars so those charts still get projection room instead of ending flush with the last candle (capped at 2000 whitespace bars). `futureWhitespace(data)` is memoized on `(lastBarTime, tfStep, barCount)` to avoid reallocating the same tail array on every render call. `withFuture(data, pts)` appends the tail.

### Date-axis — `tickLabel`

A custom `tickMarkFormatter` on every chart's `timeScale` derives the label from the tick's own UTC date (not from bar position), so months and years print cleanly across the future whitespace region where bars have no OHLC data. Type codes: 0=Year, 1=Month, 2=DayOfMonth, 3=Time.

### Pane alignment — `alignPriceAxes` / `allPaneCharts`

`allPaneCharts()` returns `[chart, rsiChart, ...ind.subCharts, ...sc.subCharts]` in top-to-bottom order. `alignPriceAxes()` measures the widest actual right-axis gutter across all panes and pins every pane to that width (`minimumWidth`), so candle columns, RSI bars, and indicator lines share the same horizontal plot area. It then calls `updateTimeAxisVisibility()` which hides the time axis on every pane except the bottom-most one (matching TradingView's single-axis layout).

### Crosshair sync — `registerPane` / `syncCrosshairToPanes`

`panes[]` stores `{chart, series, handler}` for every sub-pane. When the cursor moves over any pane, `syncCrosshairToPanes(time, source)` calls `setCrosshairPosition(0, time, series)` on every other pane. A reentrancy guard (`_xhairSyncing`) prevents ping-pong loops. The RSI pane is registered at boot; indicator and script sub-panes register themselves in `buildIndicatorSeries` / `renderScript` and unregister in `removeIndicator` / `removeScript`.

---

## 5. Drawing Engine

### Overlay canvas

`<canvas id="draw">` sits absolutely over `#chartWrap` at `z-index:100`, filling the chart area. It intercepts all pointer events. The chart's built-in `handleScroll:false` / `handleScale:false` prevents LWC from competing for the same gestures.

`sizeCanvas()` sets the canvas's backing-store resolution to `clientWidth * devicePixelRatio` and applies a DPR transform so drawings are crisp on HiDPI displays. `evtPt(e)` converts mouse events to canvas-local coordinates.

### Coordinate conversion

```
timeToX(time)   → pixel x (extrapolates past the last bar via timeAnchors())
xToTime(x)      → fractional UNIX seconds (extrapolates; no rounding so handles round-trip)
priceToY(price) → pixel y (extrapolates via priceFit() when outside visible band)
yToPrice(y)     → price (extrapolates via priceFit())
```

**Critical gotcha:** `chart.timeScale().timeToCoordinate(t)` returns `null` past the last bar. `timeAnchors()` picks the first and last *visible* bars (widest baseline) and extrapolates linearly. Adjacent bars near the right edge are often <3 px apart; using the last two bars would amplify sub-pixel error into a large gap at the drawing endpoint. `coordinateToTime` similarly returns `null` in the future region; `xToTime` extrapolates without rounding so the value round-trips cleanly through `timeToX`.

`priceFit()` probes two y-coordinates at 25% and 75% of the canvas height to build a price-per-pixel slope; `priceToY` / `yToPrice` use this slope when `priceToCoordinate` / `coordinateToPrice` return null (off-band prices).

### Magnet snap — `snap`

When `draw.magnet` is on, `snap(time, price)` finds the nearest bar by time and returns whichever of {open, high, low, close} is closest to the given price.

### Shape data model

Each shape is stored as:

```js
{ id: "s123", type: "trend", pts: [{time, price}, ...], style: {color, width, dash, fill, showLabel}, text? }
```

`pts` always stores **chart coordinates** (time in UNIX seconds, price in asset units) — never pixel coordinates. This means shapes survive panning, zooming, and resizing without any remapping.

### Pointer state machine

| Event | Action |
|---|---|
| `mousedown` | Axis drag (right gutter), alert-trash hit, select/drag shape (crosshair mode), begin new shape (draw mode) |
| `mousemove` | Forward crosshair to LWC (`updateCrosshair`), pan chart, drag shape/handle, track cursor for pending shape endpoint, hover hit-test |
| `mouseup` | End pan / axis drag / drag-edit; commit 2-pt shape on release; switch to click-click mode on a pure click |
| `dblclick` | Reset price scale (on axis), commit pending polyline (drops floating endpoint), open settings dialog on shape, reset scale on empty chart |
| `wheel` | Zoom anchored under cursor (keep bar under pointer fixed); shift+wheel = horizontal pan. Zoom limits are TradingView-style, driven by **bar spacing** (px/bar) via the shared `zoomSpanLimits()` helper: zoom **in** until a bar is ~`ZOOM_MAX_BAR_SPACING` (350 px) wide (≈4 bars fill the screen — the "almost infinite" zoom-in), zoom **out** until spacing hits `ZOOM_MIN_BAR_SPACING` (0.5 px) or the loaded history runs out. The same helper governs keyboard `+/-` zoom and the time-axis drag zoom, so all three agree |
| `contextmenu` | On the main chart (`dcanvas`): shape / alert / chart context menu. On each sub-pane element (RSI + indicator/script panes): `attachPaneContextMenu` shows Settings / Add alert on `<indicator>` / Reset view / Remove — sub-panes are separate LWC charts with no overlay canvas, so without this the browser's native menu showed instead |
| `keydown` | Esc: cancel / deselect; Delete/Backspace: delete selected shape |

**Auto-snap** (`_autoSnap`): during a fresh progressive load, `renderData` snaps the view to the latest bars on each page. The first real pan or zoom gesture calls `stopAutoSnap()` to stop re-snapping.

### Left rail — flyout categories

The left toolbar (`#toolbar`, 52px) is built by `buildToolbar()` from `TOOL_CATEGORIES` (cursor, trend-line tools, fib/gann, geometric shapes, forecasting/positions, annotation). Each category renders **one** rail button showing its current tool's icon + a `.catarrow` corner arrow. Clicking the arrow opens `openToolFlyout(cat, el)` — a `.tool-flyout` popup (dark `#1e222d`) listing the category's tools by name; picking one sets `catCurrent[cat.id]`, rebuilds the rail, and calls `selectTool`. Clicking the button body activates the category's current tool. `selectTool` reflects the active tool back onto whichever category owns it (updates that button's icon + `.active`). Below a separator sits the fixed toggle/action cluster (magnet, stay-in-drawing-mode, lock-all, hide-all, delete-all). All tool wiring/icons are reused from `TOOLS` — the categories are just a presentation layer over it.

### Drawing tool list

The `TOOLS` array and `CLICKS` map define every tool. Tool names from Wave 1/2 (original) and Wave 3 (added):

- **Lines:** Trend, Ray, Extended, Info (stats), Trend Angle, Horizontal Line, Horizontal Ray, Vertical Line, Cross Line
- **Channels/Fans:** Parallel Channel (3-click), Regression Trend (least-squares fit over bar closes + ±1σ channel), Andrews Pitchfork (3-click), Gann Fan, Gann Box (rect + diagonal + 0.25/0.5/0.75 fib grid)
- **Shapes:** Rectangle, Ellipse, Circle (radius = center→edge), Triangle (3-click), Arrow, Arrow Marker up/down (1-click, direction from click vs bar close), Polyline/Path (multi-click, dblclick to finish), Brush (freehand)
- **Fibonacci:** Fib Retracement, Fib Extension, Trend-Based Fib Extension (3-click), Fib Fan, Fib Time Zone
- **Position:** Long Position, Short Position
- **Ranges:** Price Range, Date Range, Date & Price Range, Measure
- **Annotations:** Text (prompt), Callout/Note (prompt), Flag, Price Label
- **Toggles:** Magnet (snap to OHLC), Stay in Drawing Mode, Lock All, Hide All. Plus per-shape lock (context menu) and undo/redo (Ctrl+Z / Ctrl+Y).
- **Action:** Remove All (confirm dialog)

`CLICKS[type]` gives the number of anchor points required: 1 = single-click finish, 2 = drag or two-click, 3 = three anchor points, 0 = freehand / unbounded (polyline/brush).

### Shape rendering — `drawShape` / `redraw`

`redraw()` clears the canvas, draws the vertical time grid (`drawTimeGrid`), then alert dashed lines (`drawAlertLines`), then draws every shape in `draw.shapes` order plus any pending shape. `drawShape(s, selected, hovered)` dispatches on `s.type` to per-type drawing functions. Selected shapes show white circle handles at each `pt`. The `extend(x1,y1,x2,y2,W,H)` helper clips a ray to the canvas boundary.

**Vertical grid — `drawTimeGrid`.** LWC's built-in vertical grid is disabled (`grid.vertLines.visible:false`) because it draws a line at ~every bar and turns into a dense grey wall on small timeframes. Instead `drawTimeGrid(W,H)` reads the visible time span (`xToTime(0)`→`xToTime(W)`), picks a "nice" step from `_GRID_STEPS` (1m…1y) so ~8–12 lines span the range, then draws one line per round boundary at `timeToX(t)` — count is bar-independent (matches TradingView). Boundaries align to the selected timezone (`tzOffsetMin`). Horizontal grid lines stay with LWC (already at price-axis labels). Sub-panes (RSI/indicators) keep LWC's grid since they're outside the `#draw` overlay. Verified: `test/audit_timegrid.mjs` (1d → 6 lines, 1m zoomed-out → 10 lines).

**Undo / redo.** `snapshotDraw()` pushes a `JSON.stringify(draw.shapes)` onto `_undoStack` (cap `UNDO_MAX=100`) and clears `_redoStack`; it's called *before* every mutation — add (finishPending/finishOneClick), delete, clone, reorder, setStyle, lock-toggle, remove-all, and drag/resize (snapshotted at drag *start*; a no-op click pops the snapshot back on mouseup so undo isn't cluttered). `undoDraw`/`redoDraw` swap between the stacks via `restoreShapes`. Bound to Ctrl/Cmd+Z (undo) and Ctrl+Y / Ctrl+Shift+Z (redo), suppressed while typing in an input, **and to the topbar ↩/↪ buttons** (`#btnUndo`/`#btnRedo`, placed after Replay). `updateUndoButtons()` — called from `snapshotDraw`, `restoreShapes`, the drag no-op pop, and at boot — greys out (`disabled`) each button when its stack is empty, matching TradingView.

**Per-drawing lock.** Each shape may carry `s.locked`. The context menu shows 🔒 Lock / 🔓 Unlock. A locked shape can't be dragged, resized, or deleted (guards in the crosshair-mode mousedown, the handle-resize path, and the Delete-key handler). Distinct from the global `draw.locked` ("Lock All Drawings") toolbar toggle.

**Stay-in-drawing-mode.** Toolbar toggle sets `draw.stay`. Normally a completed shape reverts the tool to crosshair (`selectTool("cross")`); when `draw.stay` is on, `selectTool(tool)` re-arms the same tool so the user can draw repeatedly (TradingView's "stay in drawing mode").

### Settings dialog — `openSettings` / `openFibSettings` (TradingView-parity, tabbed)

Double-clicking a shape (or "Settings…" from the context menu) opens `#settingsDlg` as a **tabbed dialog** (`Style` / `Coordinates` / `Visibility`, reusing the `.dtabs/.dtab/.dpane` CSS).

- **Generic tools** → `openSettings(id)`. The **Style** tab renders line color/width/style plus per-tool extras driven by `TOOL_CAPS[type]` (`fill` → fill color+opacity for rect/ellipse/position/etc.; `text` → text + text-color + font-size for text/callout/patterns; `arrow` → arrow-head toggle; `extend` → don't-extend/right/left/both for trend lines; `label:false` hides the price-label checkbox). The **Coordinates** tab lists one editable *(price, bar)* row per anchor point in `s.pts`. The **Visibility** tab holds the 8 TradingView time-scope toggles (Ticks/Seconds/…/Ranges) stored on `s.style.visibility`. All fields live-preview and persist. New render properties honored: `style.fillColor`, `style.textColor`, `style.fontSize`, `style.extend` (trend), `style.arrow`.
- **Fib Retracement / Extension** → `openFibSettings(id)`. Full TradingView parity. Fib config is now **per-shape** (`s.fib`, seeded by `defaultFibConfig()` on creation; legacy shapes migrate lazily via `getFib(s)`). **Style** tab: Trend line (show + color + dash), Levels line (width + dash), Extend, Reverse, show-level-values / show-prices, then the **24 default levels** (`FIB_DEFAULT_LEVELS`) each as checkbox + editable value + color in a 2-column `.fib-grid` filled **column-major** (`grid-auto-flow:column` + a per-page `gridTemplateRows` of ceil(n/2)) so values read top-to-bottom down the left column then down the right, in ascending order, plus "Use one color". The default level set spans **48 levels** (`FIB_DEFAULT_LEVELS` + `FIB_PAGE2_LEVELS`), merged and **sorted ascending** so the grid reads in order (0, 0.236, 0.382, …). Split into two fixed pages of 24: page 1 = 0→3.382 (only **0→1** checked), page 2 = 3.5→8 continuation (**all unchecked** until the user ticks them). The level grid is **paginated** by fixed 24-row slices; a ‹ / › pager (`fib_prev`/`fib_next`) swaps pages, committing edits first and remapping via each row's original `data-i` index.  **Templates** — a `Template ▾` menu in the footer offers **Save as…** (name → store to `fv_fib_templates`), **Save as default** (store to `fv_fib_default`; `defaultFibConfig()` returns a clone of it for new fibs, else `builtinFibConfig()`), **Apply defaults** (reset the shape to factory config), and each saved template (click to apply, ✕ to delete). The dialog gets a `.fib-dialog` class (wider 460px) with `overflow-x:hidden` + dark-themed scrollbars, and the level grid uses `minmax(0,1fr)` tracks so it never scrolls sideways. **Coordinates** and **Visibility** tabs as above. `drawFib` renders from the per-shape config (levels/colors/extend/reverse/one-color/trend line) instead of the old global `FIB_LEVELS`/`FIB_COLORS` (still used only as a fallback).

### Manual pan and price-axis drag

Because the overlay canvas captures all events, LWC's built-in pan/zoom is disabled. Pan is reimplemented in `startPan` / `doPan`: horizontal drag moves the time scale by `(dx / barSpacing)` bars; vertical drag **translates `manualPriceRange`** by the dragged pixels converted to price (`dy/h × span`), preserving the span so candle size never changes. Unlike the old balanced-`scaleMargins` approach (bounded to [0,1]), a price-range offset has no limit — the band can be dragged arbitrarily far, like TradingView. Panning takes over the scale (auto-scale off until reset).

Right-axis vertical drag (`startAxisDrag` / `doAxisDrag`) computes an exponential zoom factor from drag distance and sets `manualPriceRange`, honoured by `candle.autoscaleInfoProvider`. Double-clicking the axis calls `resetPriceScale()` (clears `manualPriceRange`, restores auto-scale + default margins).

**Entering manual scale.** The first drag/pan calls `enterManualScale()`: it seeds `manualPriceRange` from the currently-visible range and **zeros the price-scale margins** (`_manualMargins` guard, idempotent). This is essential — with the default 0.2/0.1 margins LWC pads the range returned by the autoscale provider, inflating the rendered span; across successive vertical pans that inflation compounds (the band grows instead of translating). Zeroing margins makes `manualPriceRange` map 1:1 to the pane. `resetPriceScale` / a fresh symbol-TF load restore margins to 0.2/0.1 and clear `_manualMargins`.

**Unbounded zoom.** Two shared providers gate the right scale: `candleScale` (returns `manualPriceRange` when set, else the series' own extent) is used by `candle` and every aux chart-type series (they ARE the primary price series when their type is active); `overlayScale` (returns `null` — i.e. excluded from autoscale — when `manualPriceRange` is set) is used by the MAs and every main-pane indicator/script overlay. Without this, those overlays would merge their own data extent into the price scale and floor the visible span, blocking zoom-in. `startAxisDrag` also re-bases from `manualPriceRange` (the requested window) rather than a read-back of LWC's clamped coordinate map, so successive drags keep compounding and zoom is effectively unlimited. Compare series live on a separate `"compare"` price scale and are unaffected. Verified: `test/regression_price_axis_zoom.mjs`, `test/regression_price_pan_vertical.mjs`.

The **RSI sub-pane** gets the same axis stretch independently. It's a separate LWC chart with no `#draw` overlay, so drag handlers attach directly to `#rsi` and hit-test its own right-axis gutter (`inRsiPriceAxis`); hovering the gutter (or dragging) sets an `ns-resize` cursor. Dragging sets `manualRsiRange`, honoured by `rsiScale`, which is wired as the `autoscaleInfoProvider` on **all six** RSI-pane series (line, MA, over-fill, under, 70/50/30 bands) — not just `rsiLine`. This matters: the band lines sit at fixed 30/50/70, so if they contributed their own autoscale extent LWC would floor the merged visible range at ~[30,70] and block zoom-in. Each drag re-bases off the requested `manualRsiRange` (not a read-back of LWC's clamped view), so zoom in/out is effectively unbounded. `manualRsiRange` null ⇒ default 18–82 window; double-clicking the RSI axis resets to it. Verified: `test/regression_rsi_axis_drag.mjs`.

---

## 6. Indicators

### Catalog — `IND_CATALOG`

~76 entries, each with `{type, name, cat, pane, params}`. Categories: Moving Averages, Oscillators, Momentum, Trend, Volatility, Volume, Bill Williams, Other. `pane` is either `"main"` (overlay) or `"sub"` (separate pane below `#subPanes`). "Wave 5" added the full TradingView-technicals parity set — McGinley, KAMA, Chande Kroll Stop, Linear Regression Channel, TSI, KST, RVI, SMI, Woodies CCI, Connors RSI, Ease of Movement, Klinger, Net Volume, Volume Oscillator, TWAP, Bollinger %B, Historical Volatility, Mass Index, Ulcer Index, Bull Bear Power, MA Ribbon, 52-Week High/Low. Adding an indicator = 4 edits: `IND_CATALOG` entry + `plotSpec` case (series descriptors) + `renderIndicator` case (calc → setData) + a calc function.

### Lifecycle

- **`addIndicator(type, opts?)`** — creates an entry in `indicators[]`, calls `buildIndicatorSeries` then `renderIndicator`; `opts` may carry `{params, hidden, silent}` (used by `loadIndicators` to restore persisted state without re-saving). Calls `saveIndicators()` unless `silent`.
- **`buildIndicatorSeries(ind)`** — for `pane:"main"` indicators, creates series on `chart`. For `pane:"sub"`, creates a `<div class="subpane">` in `#subPanes`, creates a new `LightweightCharts` instance, wires bidirectional time-scale sync with `chart`, calls `registerPane`, and wraps each series with `alignSubSeries`.
- **`renderIndicator(ind)`** — calls the appropriate `*Calc` function(s) and calls `series.setData(...)`. Dispatches on `ind.type` via a large switch.
- **`removeIndicator(id)`** — unsubscribes time-scale sync handlers, removes series, removes the sub-chart and its DOM element, calls `unregisterPane`.
- **`toggleIndicatorHidden(id)`** — 👁 eye toggle (in the sub-pane label and the main-chart legend). Sets `ind.hidden`, toggles each series' `visible`, and dims the pane (`.hiddenInd`) without removing the indicator.
- **`wirePaneResize(grip, el)`** — each sub-pane carries a `.paneResize` grip on its top border. Dragging it adjusts the pane's flex-basis height (clamped 70–500px) live and calls `subChart.applyOptions({width,height})` so the LWC chart re-fills, then `alignPriceAxes()` on release.
- **`renderAllIndicators()`** — calls `renderIndicator` on every active indicator; called from `renderData`.

### Plot descriptors — `plotSpec(ind)`

Returns an array of `{k, color, w}` plot specs (kind `"line"` or `"hist"`) so `buildIndicatorSeries` stays data-driven. Multi-series indicators (MACD = hist + 2 lines, BB/KC/Donchian = 3 lines, ADX = 3 lines, Ichimoku = 5 lines) each return the appropriate array.

### Timeline alignment — `fullSeries` / `alignSubSeries`

Calc helpers return shorter arrays (they start at `i = period - 1`). A sub-pane synced by logical bar index would shift left if its series is shorter than the main chart's. `fullSeries(data, pts)` re-keys the output onto the complete `data` timeline, inserting whitespace `{time}` entries for warmup bars, then appends `futureWhitespace(data)` so sub-pane indicators reach the future region in lockstep. `alignSubSeries(series)` wraps a series's `setData` to call `fullSeries` automatically.

### Hardwired indicators

MAs (default 7/25/99/150/200/300) are held in the mutable `MAS` array (`{p, color, w, on, type, src, ls}`) and rendered directly in `renderData` via `renderMaLegend` → `maLine`. `maLine(data, m)` picks the source column (`src`: close/open/high/low/hl2/hlc3/ohlc4) and MA kind (`type`: sma/ema/wma/rma via `smaA`/`emaA`/`wmaA`/`rmaA`). They are **editable**: the `#maLegend` row ends with a ⚙ gear (`#maGear`) opening `openMaSettings` — a dialog to change each MA's type, period, source, color, width, line style, toggle visibility, add/remove, and Reset to defaults (`DEFAULT_MAS`). Add/remove rebuilds the line series via `rebuildMaSeries` (`maSeriesOpts` shares the option shape); edits persist to `localStorage["fv_mas"]` (`saveMas`). The legend label reflects the type (e.g. `EMA25`, `SMMA99`) via `maTag`. RSI(14) is rendered via `rsiSeries` / `maOfSeries` into the always-visible `#rsiWrap` pane (not part of `indicators[]`).

### Indicators dialog — `toggleIndicatorsMenu`

Two tabs: **Technicals** (full catalog, grouped by `cat`) and **★ Favorites** (filtered to `indFavorites`). Live search filters by name/category. Each row has a star toggle (`toggleFavorite` → persisted in `localStorage["fv_ind_favorites"]`); clicking the name adds the indicator. "Community" tab is omitted (no backend). `_indTab` holds the active tab.

### Indicator settings — `openIndicatorSettings` (TradingView-style dashboard)

A tabbed dialog (**Inputs / Style / Visibility**), driven by two data sources:

- **`IND_META[type]`** — hand-authored per indicator: `inputs` (`{key,label,type:"num"|"src",min,step}` in TradingView order/labels, e.g. MACD → "Fast Length"/"Slow Length"/"Signal Smoothing") and `plots` (readable names index-aligned to `plotSpec`, e.g. `["Histogram","MACD","Signal"]`). Any type missing meta falls back to auto-labelled params (`autoLabel`) + "Plot N".
- **`plotSpec(ind)`** — the existing per-plot descriptors (line/hist, default color, width), used to build the Style/Visibility rows.

**Inputs** tab edits `ind.params` (source via `<select>` over `SRC_OPTS`). **Style** tab edits per-plot `ind.plotStyle[i] = {color, width, style}` (line plots get width + line-style from `LINE_STYLES = Solid/Dotted/Dashed`; histograms get color only) plus an output **Precision** (`ind.precision`, Default | 0–8). **Visibility** tab toggles `ind.plotHidden[i]`; its checkboxes mirror the Style-tab ones live.

- **`ensurePlotState(ind)`** seeds `plotStyle`/`plotHidden` from `plotSpec` defaults (width rounded to an integer 1–6) the first time, and grows the arrays if the plot count changes (e.g. ribbon `count`).
- **`applyIndicatorStyle(ind)`** applies the stored style/visibility/precision onto the live LWC series; called after every `renderIndicator` (which only `setData`s, never recreates series) and on `addIndicator`.
- Persistence: `saveIndicators()` serializes `plotStyle`, `plotHidden`, `precision` alongside `params`/`hidden`; `loadIndicators` restores them through `addIndicator` opts. Legacy single `color` param stays synced to `plotStyle[0].color` so the legend swatch matches. See `test/regression_ind_settings.mjs`.

---

## 7. Freeview Script (Wave 4)

A sandboxed mini custom-indicator language. The user writes a JavaScript body in the `#scriptDlg` editor. The engine evaluates it against the current bar data and renders the results as live series.

### Execution — `runScript(code, data)`

1. Builds input arrays: `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, `ohlc4`, `time`.
2. Builds `ta` via `makeTA(data)` — exposes `sma`, `ema`, `wma`, `rma`, `stdev`, `highest`, `lowest`, `rsi`, `atr`, `change`, `roc`, `crossover`, `crossunder`, `cross`. All operate on `number[]` aligned to bars.
3. Defines `plot(arr, opts)` and `plotHist(arr, opts)` collectors.
4. Creates a `new Function(...params, '"use strict";\n' + code)` where the parameter list includes the curated API plus every name in `BLOCKED` shadowed as `undefined`. `BLOCKED` covers `window`, `document`, `globalThis`, `fetch`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, `navigator`, `location`, `Worker`, `Function`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `postMessage`, etc.
5. Calls the function; returns the collected `plots[]`.

**Security note:** the shadow-parameter sandbox is a guard-rail, not a true security boundary. Scripts that reference `eval` or `arguments` are rejected by a source-level check. A determined user can escape via `.constructor.constructor`. This is acceptable because Freeview is a local single-file app evaluating the user's **own** code on their **own** machine.

### Rendering — `renderScript(sc)` / `renderAllScripts`

After `runScript`, tears down any existing series, then for each plot:
- If any plot targets `pane:"sub"` and no sub-chart exists yet, creates one (same flow as `buildIndicatorSeries` for sub-pane indicators), registers the crosshair, and wires bidirectional time-scale sync.
- If no plot targets `"sub"` but a sub-chart exists from a prior edit, destroys it.
- Creates a `LineSeries` or `HistogramSeries` on the correct chart and calls `scriptPair(data, arr)` to attach timestamps (null/NaN entries become whitespace).
- Calls `setPaneSeries(sc.subChart, s)` to anchor the crosshair to a live series.

Script errors are caught and surfaced as a "⚠ error" chip in the legend. A live validity check in the editor dialog dry-runs the script against the first 60 bars on every keystroke.

### Persistence

`saveScripts()` writes `JSON.stringify(scripts.map(s=>({name,code})))` to `localStorage` under `fv_scripts_<activeSymbol>`. `loadScripts()` reads and re-adds them. Scripts auto-run on load and on every symbol/TF change (via `loadScripts` then `addScript` then `renderScript`).

---

## 8. Alerts

Client-side price-crossing alerts. Backed by `alerts[]` (per-symbol, in-memory); persisted to `localStorage`.

### Alert model

```js
{
  id, source, op, target, value,
  trigger,   // "once" | "every"
  expiry,    // epoch ms | null
  message,
  notify: { popup, sound, browser, email },
  webhook,   // user-defined URL | "" — POSTed on trigger (no backend needed)
  active, _last
}
```

`source` and `target` are keys from `ALERT_SOURCES`: `"price"`, `"ma7"` through `"ma300"`, `"rsi"`. `op` is one of `crossing | crossUp | crossDown | gt | lt`.

### Evaluation — `checkAlerts` / `alertTriggered`

Called from `renderData` on every paint. `sourceValue(key)` computes the current value of each source from `lastData`. `alertTargetValue(a)` resolves the RHS (either a fixed number or a source value). `alertTriggered` uses `a._last` (the previous LHS-minus-RHS difference) to detect sign changes for crossing ops; level ops (`gt`/`lt`) fire on current state. Expired alerts are deactivated; "once" alerts deactivate after firing.

### Firing — `fireAlert`

On trigger: browser `Notification` (if permission granted and `notify.browser`), in-app toast div with 6-second auto-remove (if `notify.popup`), Web Audio API beep at 880 Hz (if `notify.sound`). If `a.webhook` is set, a fire-and-forget `fetch()` POSTs `{symbol, message, value, source, op, target, time}` JSON to that URL (`mode:"no-cors"`, `keepalive:true`) — no backend required, works from any static host. Email requires a backend and is silently no-op.

### Visual — `drawAlertLines`

For `price`-vs-`value` alerts, `redraw` calls `drawAlertLines()` which draws a dashed horizontal line at `priceToY(a.value)`, a right-edge price pill, and (on hover) a pill with a vector trash icon. `alertHitboxes[]` stores `{id, y, trash}` for mouse hit-testing (`alertHit`, `alertTrashHit`).

---

## 9. Persistence (localStorage)

| Key pattern | What is stored | Written by | Read by |
|---|---|---|---|
| `fv_watchlist` | `GROUPS[]` — array of `{name, symbols[], collapsed?}` | `saveGroups()` | `loadGroups()` at boot |
| `fv_draw_<symbol>_<tf>` | `draw.shapes[]` — array of `{id, type, pts, style, text?}` | `persist()` | `loadPersisted()` on symbol/TF change and at boot |
| `fv_scripts_<symbol>` | `[{name, code}]` — user script name and source | `saveScripts()` | `loadScripts()` on symbol change and at boot |
| `fv_alerts_<symbol>` | `[{id, source, op, target, value, trigger, expiry, message, notify, webhook, active}]` | `saveAlerts()` | `loadAlerts()` on symbol change and at boot |
| `fv_recent_wl` | `RECENT_WL[]` — watchlist names, most-recent-first (drives the list-menu RECENTLY USED section) | `pushRecentWL()` on every `switchWatchlist` | read at boot |
| `fv_indicators_<symbol>` | `[{type, params, hidden}]` — active indicators | `saveIndicators()` on add/remove/hide/settings | `loadIndicators()` on symbol change and at boot |
| `fv_active_symbol` / `fv_active_tf` | last-viewed symbol + timeframe key | `saveActiveState()` on symbol/TF change | read at boot (before first `loadChart`); `validateRestoredTF` rebuilds a custom `c<sec>` TF entry or falls back to `1d` |
| `fv_tz` | timezone offset (minutes east of UTC) | `applyTz()` | read at boot |

| `fv_ind_favorites` | array of catalog `type` keys starred in the indicators dialog | `saveFavorites()` | read at boot |

**Watchlist import/export** — `exportWatchlist()` downloads a `.txt` in `###SECTION` + symbols-per-line format; `importWatchlistText(txt)` parses it back into `GROUPS`, saves, and rebuilds. Buttons ⭱/⭳ in `#wlHead`.

**Session breaks** — `drawSessionBreaks(W,H)` (in `redraw`) draws faint vertical lines at each tz-adjusted day boundary, but only on intraday timeframes (`tfStepSec() < 86400`); daily+ early-returns. Also gated on visible span: skipped when the view spans >15 days, so a zoomed-out 4h/6h/12h chart doesn't render one line per day (a grey wall) — beyond that window `drawTimeGrid` provides the round-interval grid instead.

**Volume Profile** — a `pane:"overlay"` catalog indicator that toggles `window.volProfileOn` instead of creating a LWC series (handled specially in `addIndicator`/`removeIndicator`). `drawVolumeProfile(W,H)` (in `redraw`) bins the visible bars' volume into 40 price buckets and draws a horizontal histogram on the left edge, highlighting the POC (highest-volume) bucket in orange. The floating legend (`#chartLegend`) has a `#legCollapse` chevron that toggles `.collapsed` to hide the MA/indicator rows.

**Screenshot / fullscreen** — 📷 `saveScreenshot()` composites `chart.takeScreenshot()` (main chart canvas) with the `dcanvas` drawing overlay onto one canvas → PNG download `freeview-<symbol>-<tf>.png` (sub-panes not included). ⛶ `toggleFullscreen()` requests/exits fullscreen on `#app` and re-runs `resize()`/`sizeCanvas()` on `fullscreenchange`.

**Keyboard shortcuts** (in the window `keydown` handler, skipped while typing): Arrow ←/→ pan the time axis (`scrollToPosition ±3`), `+`/`-` zoom the visible logical range (×1/1.2 / ×1.2), `Alt+H` drops a horizontal line at the crosshair price. (Esc cancels, Del deletes selected, Ctrl+Z/Y undo/redo — see drawing engine.)

**Top toolbar** (`#topbar`, 38px) — TradingView order with thin `.tbdiv` dividers: symbol search (`#symbolBox`) │ interval (`#tfSel`) │ chart type (`#ctSel`) │ Indicators · Alert · Script, then a `.tbspacer` (flex:1) pushes screenshot 📷 + fullscreen ⛶ + live status to the right. `.tbtn` buttons are 28px tall with a rounded `#2a2e39` hover pill. The scale toggle + timezone selector live in the HTML here but are re-parented to the bottom bar at boot.

**Bottom bar** (`#bottomBar`, TradingView-style) — spans the base of the chart column. Left: `#rangeShortcuts` date-range buttons (1D 5D 1M 3M 6M YTD 1Y 5Y All); each calls `applyRange(r)` which converts the target start time to a logical bar index and calls `setVisibleLogicalRange`. Right: `#bottomRight` holds the timezone selector (`#tzSel`) and scale toggle (`#btnScale`), relocated there from the top toolbar at boot by `initBottomBar` (which just re-parents the existing wired DOM nodes). YTD uses the tz-adjusted Jan-1; All spans the full loaded history.

**Floating on-chart legend** (`#chartLegend`, TradingView-style) — a semi-transparent box pinned top-left over the chart (inside `#chartWrap`), holding three stacked rows: `#legSymRow` (symbol · tf · exchange + OHLC), `#maLegend` (the six MAs, colored, tabular-nums), and `#indLegend` (one row per added indicator with eye/gear/× + hover value). The symbol row is synced in `loadChart`; OHLC via `updateOhlcLegend`. These values were moved off the top toolbar (which now holds only controls) to match TradingView. **`updateOhlcLegend(time)`** finds the bar nearest the crosshair (or the latest bar on load, from `renderData`) and renders `O H L C` plus the **change** (abs + %) vs the previous close, green/red.

**Symbol search** — the top-bar symbol name (`#symbolBox`, with a 🔍 icon) is clickable → `openAddSymbolDlg(null)`, opening the `#symDlg` search modal (categories All/Coinbase/Binance/Bybit/Stocks, live-filtered, keyboard-navigable). Right-clicking it opens `showSymbolInfo` — a popover with the symbol's structured details (symbol, exchange/type or numerator/denominator for ratios, base/quote, timeframe, last).

**Infinite scroll-back** — `chart.timeScale().subscribeVisibleLogicalRangeChange` fires `loadOlderHistory()` when the view's `from` index drops below 30 (near the left edge of loaded bars). It fetches a few older pages via `fetchOlderPages(leg, tf, oldestTime, pages)` (both legs re-`makeRatio`'d for spreads), prepends the bars to `lastData`, repaints with `keepView`, and shifts the visible logical range by the prepended count so the view doesn't jump. Guards: `_loadingOlder` (in-flight) and `_historyExhausted` (a short page = start of history, or the 50k-bar `MAX_BARS` ceiling is reached — the older batch is trimmed so `lastData` never exceeds 50k), both reset on symbol/TF change in `loadChart`.

**Bar replay** — the ⏮Replay button arms a picker; clicking a bar sets `_replay.idx`. While `_replay.active`, `renderData` keeps the full series in `_replay.full` but slices `lastData` to `_replay.idx`, so only history up to the cursor shows. The `#replayBar` (⏪ step-back / ▶ play-pause / ⏩ step / position / ✕ exit) drives `replayStep`/`replayPlay` (400ms auto-advance). Exit reveals the full series and re-snaps.

**Object tree** — the 🗂 button opens `#objTree`, a panel listing all `draw.shapes`, `indicators`, and `scripts` with per-item 👁 hide (indicators) and × delete (routes to `deleteShape`/`removeIndicator`/`removeScript`).

**Named watchlists** — `WATCHLISTS = {name: groups[]}` with `ACTIVE_WL`; the legacy single `fv_watchlist` migrates in as "comeback". `saveGroups` writes both the legacy key and `fv_watchlists`/`fv_active_wl`. The `#wlNameBtn` header dropdown is a full TradingView-style list menu: Share list (`shareWatchlist`, clipboard stub), Add alert on the list (`alertOnList`), Make a copy (`copyWatchlist`, deep-clone), Rename (`renameWatchlist`), Add section (`addGroup`), Clear list (`clearWatchlist`), Create new list (`createWatchlist`), Upload list .txt (`#wlImportFile` → `importWatchlistText`), Open list / Shift+W (`openListBrowser` dialog), plus a RECENTLY USED section (from `RECENT_WL`, click to switch). Switching swaps `GROUPS` to the active list and rebuilds the view.

**Invert / percent scale** — the chart right-click menu offers Auto/Log/Percent (`setScaleMode` → priceScale `mode`) and Invert (`toggleInvertScale` → priceScale `invertScale`, flips the chart vertically).

**Right rail + stubs** — a far-right vertical icon rail (`#rightRail`) gives quick access to Watchlist / Alerts / Object tree / News / Screener / Paper trading. News/Screener/Paper open `openStubPanel(kind)` — explicitly placeholder panels (no backend / feed in this single-file build). **Resizable watchlist**: `#wlResize` grip drags the panel width (200px–50%, `--wl-w` CSS var, persisted `fv_wl_width`); the topbar/grid use `right:0` inside `#main` so they follow the resize.

**Pattern tools / tool favorites** — `elliott` (6-click 0-1-2-3-4-5), `xabcd` (5-click X-A-B-C-D), and `headshoulders` (7-click LS/T1/H/T2/RS + 2 neckline points) are labeled multi-point tools rendered by `drawLabeledPath` (connected segments + a label bubble at each vertex); all three share the polyline-style multi-point hit-test and persistence. `TOOL_FAVS` (persisted `fv_tool_favs`) pins favorited drawing tools to a cluster at the top of the left rail; the flyout rows have a ☆/★ star (`toggleToolFav`).

**Toasts / settings gear** — `toast(msg, kind)` shows a bottom-center notification (`#toastWrap`, ok/err variants, auto-dismiss), wired to screenshot-save and drawing-template-save. A ⚙ topbar button opens the chart-settings dialog.

**Drawing templates / pane controls** — a shape's context menu → "⭐ Save style as default" (`saveDrawTemplate`) copies its style into `DEFAULT_STYLE` and persists `fv_draw_default` (restored at boot), so new drawings inherit it. Sub-pane labels gained ▁ collapse (`togglePaneCollapse` → 22px strip) and ⤢ maximize (`togglePaneMaximize` → 70vh) buttons alongside gear/close. On each WebSocket tick `flashLastPrice(up)` briefly flashes the last-price/countdown pill green/red.

**Chart settings / templates** — the chart right-click menu → "⚙ Chart settings…" opens a dialog for candle up/down colors, background, gridline color + visibility (`CHART_SETTINGS`, `applyChartSettings`, persisted `fv_chart_settings`, restored at boot). **Indicator templates**: the indicators dialog has a Templates dropdown — `saveIndTemplate`/`loadIndTemplate` store/restore a named set of indicators in `fv_ind_templates`. **Alert on drawing**: `alertSourcesWithDrawings()` adds line drawings (hline/hray/trend/ray/ext) to the alert source/target lists; `sourceValue("draw:<id>")` resolves the drawing's level (trend/ray extrapolated to the last bar).

**Alert enhancements** — trigger frequency now includes `perbar` (once per forming bar, guarded by `a._lastBar`) alongside `once`/`every`. `fireAlert` records to `ALERT_LOG` (persisted `fv_alert_log`, last 100), shown in the alerts panel's HISTORY section. Each alert row has a ⏸/▶ pause toggle. `ALERT_SOURCES`/`sourceValue` expose 15 operands: price, the six MAs, RSI, MACD line/signal, ATR, CCI, VWAP, Williams %R, Volume — all computed live from `lastData`.

**Strategy tester** — Freeview Script exposes a `strategy` API: `strategy.entry(cond[])` / `strategy.exit(cond[])` mark per-bar long entry/exit signals (also plotted as ▲/▼ markers). `runScript` carries the signals out on `plots._signals`; `runBacktest(data, signals)` simulates a long-only strategy (enter at the *next* bar's open when entry fired & flat, exit at next open when exit fired & long — no look-ahead), returning `{trades, netPct, winRate, numTrades, equity}`. `renderStrategyResults` shows a `#strategyPanel` (Net %, win rate, #trades + recent-trades list). Also added script plot helpers `plotshape`/`hline`/`fill` and confirmed the `ta.*` built-ins (sma/ema/wma/rma/stdev/highest/lowest/rsi/atr/change/roc/crossover/crossunder).

**Multi-chart grid** — a low-risk iframe approach (chosen over refactoring ~170 single-chart references). The layout selector (`#layoutSel`: Single/2h/2v/4) calls `buildGrid(layout)`, which fills `#chartGrid` (CSS grid) with N `<iframe src="index.html?embed=1&sym=X&tf=Y">` — each a full independent Freeview instance. `IS_EMBED` (from `?embed=1`) hides the panel's watchlist and disables active-state persistence so panels don't clobber each other. `fv_layout` auto-persists the layout + per-panel symbols; named layouts live in `fv_layouts_named`. Cross-panel crosshair sync uses `postMessage`: embed panels emit their crosshair time on `subscribeCrosshairMove`, the host relays it to sibling panels which call `setCrosshairPosition` (guarded by `_xhairFromParent`); a `setsym` message loads a symbol into a panel.

**Light theme** — the 🌙/☀ toolbar button toggles `<html class="light">`, which flips the CSS custom properties to a TradingView light palette (`--bg:#fff`, `--text:#131722`, green `#089981`, red `#f23645`, etc.). `applyTheme(light)` also re-applies matching `layout`/`grid`/`border` colors to every LWC chart (main, RSI, indicator + script sub-panes, compares) and persists to `localStorage["fv_theme"]` (default dark, restored at boot).

**Real-time WebSocket** — `wsConnect()` opens Coinbase's public `wss://ws-feed.exchange.coinbase.com` and subscribes to the `ticker` channel for the active symbol's Coinbase leg(s) (`wsProductsForActive`). Each tick updates `_wsLast[product]`; `applyTick()` recomputes the live price (ratio = legA/legB), writes it into the forming bar's close/high/low, and re-routes the update through `applyChartType(lastData)` (a full `setData` with the future tail) rather than `candle.update()`. This is deliberate: the candle series' last point is the ~4-month **future whitespace** tail, so `candle.update({time: lastBar})` targets an interior time and throws `Cannot update oldest data` in Lightweight Charts — and that failed update **truncates the whitespace tail**, leaving the time scale scrolled into a now-empty future region and blanking the visible candles. `applyChartType` re-supplies the tail every tick, so the view stays intact. `ws.onclose` reconnects with exponential backoff (1s→64s cap). A 1s poll of `activeSymbol` re-subscribes on symbol change. The 20s `loadChart` poll stays as source-of-truth / reconnect safety net and covers Binance/Bybit/Yahoo legs the WS doesn't handle.

**Compare overlay** — the ＋Compare button prompts for a symbol; `addCompare(sym)` fetches it (`fetchKlines`) and plots a **% -normalized** line (change from its first bar) on its own hidden price scale (`priceScaleId:"compareN"`), so assets at very different price levels overlay comparably. `COMPARE` holds `{sym:{series,color}}`; chips render in the floating legend (`#compareLegend`) with an × to remove; `reloadAllCompares` refetches them when the base chart reloads (TF change). `loadCompareData` re-reads `COMPARE[sym]` after its `await` and bails if the series was removed or replaced mid-fetch (`COMPARE[sym]!==c`), so a compare removed/re-added while its fetch is in flight can't write to a disposed or stale Lightweight Charts series.

**Indicator hover values** — `recordData(series)` wraps a series' `setData` to stash the last array on `series._data` (LWC has no getData). `updateIndLegendValues(time)` (called from `updateCrosshair`) looks up each indicator's value at the crosshair time via `valueAtTime` and writes it into the legend row's `.vals` slot (overlays) or a `.subVals` span in the sub-pane label (oscillators); cleared on mouseleave (legend reverts to the latest bar).

**Watchlist column sort** — the `#wlCols` header cells (Symbol/Last/Chg/Chg%) are clickable → `sortWatchlist(key)` cycles asc → desc → off. Non-destructive: `GROUPS` order is never mutated; `buildWatchlist` renders each group via `sortedSymbols(g.symbols)` which returns a sorted copy keyed off `PRICE_CACHE` (updated by `refreshPrices`) when `wlSort` is set. Rows are 28px; price cells flash via `flash-up`/`flash-down` keyframes on change.

**Watchlist flags** — `SYMBOL_FLAGS` maps symbol → hex color, persisted in `localStorage["fv_flags"]`. A right-click row menu (`showRowMenu`) offers 6 `FLAG_COLORS`; the chosen color renders as a ⬤ dot at the left of the row.

Drawings are keyed per **symbol + timeframe** so a BTC-USD 1D layout does not clobber BTC-USD 1H. Scripts, alerts, and indicators are keyed per **symbol only**. Active symbol/TF, timezone, and indicator favorites are global. So a reload restores the full workspace: symbol, timeframe (incl. custom), drawings, indicators (with params + hidden state), alerts, scripts, and timezone.

---

## 10. Watchlist

The watchlist panel (`#watchlist`, 300 px fixed right) renders `GROUPS[]` as collapsible sections with draggable rows.

### Groups and rows

`buildWatchlist()` clears `#wlBody` and iterates `GROUPS`. Each group gets a `.section` header with collapse toggle and a trash icon (visible on hover). Each symbol gets a `.row` with a coin logo (`logoForBase` via CoinCap CDN), exchange badge, last price, absolute change, and percent change columns plus a per-row trash icon.

Row click: sets `activeSymbol`, calls `loadPersisted` / `loadAlerts` / `loadScripts`, then `loadChart`.

### Drag-to-reorder

HTML5 drag-and-drop via `wlDragWire(row)`. Dragging a row over another shows a blue insertion indicator (`.drop-above` / `.drop-below`). `moveSymbol(fromGroup, fromSym, toGroup, toSym, before)` splices the symbol in `GROUPS` and calls `saveGroups` + `buildWatchlist`. Dropping onto a collapsed section header (`.section`) appends to that group via `sectionDropWire`.

### Add-symbol dialog — `openAddSymbolDlg`

Opens `#symDlg` with a search input and exchange tabs (All / Coinbase / Binance / Bybit / TradingView). `loadProducts()` fetches the full product list from all four crypto venues in parallel via `Promise.allSettled` (a venue that fails is silently skipped). Results are cached in `PRODUCTS`.

The "TradingView" tab fetches from Yahoo Finance's search endpoint (`/v1/finance/search`) via `fetchTVResults(q)` then `proxyJSON`. Results are cached in `tvCache` per query. `scheduleTVSearch(q)` debounces remote calls by 220 ms and guards against stale async responses with a sequence counter (`tvSeq`).

`symMatches(q)` scores and ranks results: exact ID match = 100, exact base = 90, prefix = 80, name substring = 40. Yahoo results receive a baseline of 50 so relevant remote matches surface above loose crypto ones.

### Live prices — `refreshPrices`

Buckets all legs by venue, fires bulk ticker calls for Binance and Bybit (`fetchBulkBinance`, `fetchBulkBybit` — one call per venue/market covers all legs), individual `/stats` calls for Coinbase legs (concurrency-capped at 4 via `mapLimit`), and `fetchStatsYahoo` for Yahoo legs (capped at 3). Price and change are computed for ratio symbols by dividing both legs' stats. Row cells are updated with flash animations on price change.

---

## 11. Event / Refresh Model

```
boot
├─ buildWatchlist()
├─ loadPersisted()        // drawings for activeSymbol + activeTF
├─ loadAlerts()           // alerts for activeSymbol
├─ loadScripts()          // scripts for activeSymbol
├─ loadChart(activeSymbol, activeTF)
├─ resize() + sizeCanvas()
└─ setTimeout(refreshPrices, 1200)   // delayed so chart fetch gets the connection pool first

then:
  setInterval(refreshPrices, 6000)                          // live watchlist prices
  setInterval(loadChart(sym, tf, keepView=true), 20000)     // background chart refresh (no snap)
  window.addEventListener("resize", resize + sizeCanvas)
```

`loadChart(symbol, tf, keepView)` uses a `loadToken` counter so stale in-flight progressive callbacks are discarded when the user switches symbol or TF before the previous load completes. **`loadOlderHistory` also captures the token** (`startToken`) and aborts its prepend if the token changed mid-fetch — otherwise a scroll-back fetch in flight when the user switches TF could prepend the *previous* TF's bars onto the new chart (the reported intermittent "shows me a different chart" glitch).

`keepView=true` (background refresh) preserves `manualPriceRange`, skips resetting the viewport, and does not re-snap. `keepView=false` (fresh load) clears `manualPriceRange`, restores default scale margins, and enables auto-snap until the user pans.

---

## 12. Known Constraints / Out of Scope

From `AUDIT.md` §7 and `README.md` "Known limitations":

- **1-minute history** is capped at ~5 days by Coinbase's own limit.
- **Weekly bar edges** are aligned to Unix-epoch weeks (Thursday start); TradingView's weekly starts Monday, so bucket edges can differ by a few days.
- **Ratio wicks** are approximated by component-wise division. A synthetic spread has no truly traded intraday high/low, so wicks will not be pixel-identical to TradingView's spread charts.
- **CORS-proxy dependency for Yahoo Finance.** The three public proxies (allorigins, corsproxy.io, thingproxy) are free and occasionally flaky (403/500). Two-pass retry mitigates transient failures but cannot guarantee availability.
- **No server-side alerts.** Alerts only fire while the browser tab is open. Email notification is wired in the UI but silently no-ops (requires a backend).
- **No backtesting / strategy tester.** Freeview Script can compute indicators but has no order simulation.
- **No replay mode.** Bar replay requires replaying the data pipeline; deferred to a future wave.
- **No multi-chart layouts.** Single chart only.
- **No licensed global data.** Stocks, ETFs, and forex are served via Yahoo Finance's public (unauthenticated) endpoint; real-time quotes for non-crypto assets are subject to Yahoo's data agreements and may be delayed.
- **Freeview Script sandbox is not a true security boundary.** It is the user's own code on their own machine; `.constructor.constructor` can escape the parameter shadow. The shadow is a usability guard-rail only.
