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

Everything lives in **`index.html`** (~9950 lines). The file is three sections in order:

| Section | Lines (approx.) | Contents |
|---|---|---|
| `<style>` | 11–787 | All CSS: dark-theme variables, layout (flex #app), toolbar, topbar, watchlist, dialogs, sub-panes, indicator legend, context menu, alert dialog, add-symbol dialog, pair info card |
| HTML skeleton | 789–913 | `<body>` tree: `#toolbar` (left drawing bar), `#main` > `#topbar` + `#chartWrap`/`#chart`/`#draw` + `#rsiWrap`/`#rsi` + `#subPanes`, floating UI (`#ctxMenu`, `#indicatorsMenu`, `#alertsPanel`, `#settingsDlg`, `#alertDlg`, `#scriptDlg`, `#symDlg`, `#pairCards`, `#dlgBackdrop`), `#watchlist` |
| `<script>` | 914–9944 | The entire application: data layer, render layer, drawing engine, indicators, Freeview Script, alerts, watchlist, persistence, boot |

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

`resolveLeg(leg)` parses the prefix and returns `{exchange, rest, isPerp, leg}`. Helper functions `legBase()` and `legShort()` derive the base ticker and display label. `symLabel(sym)` is the display formatter used everywhere a symbol is shown (watchlist row, topbar `#symName`/`#legSym`, sort key, context menus, symbol-info popover): a plain leg → its `legShort`; a spread `A/B` → each leg run through `legShort` and rejoined, so `BINANCE:NEARUSDT/BINANCE:INJUSDT` renders as `NEARUSDT/INJUSDT` (venue prefixes stripped; no exchange badge on ratios). The raw prefixed leg is still what's stored and fetched.

Coinbase and Binance/Bybit send permissive CORS headers, so the browser fetches them directly. Yahoo Finance does not; those calls go through `fetchJSONDirectOrProxy()` (direct → the app's own `/api/market/proxy` → the public `proxyJSON()` chain as last resort).

### Fetch timeout — `fetchTimeout(url, ms=8000, opts)`

Every upstream candle/proxy request goes through `fetchTimeout`, a thin `fetch` wrapper that aborts via `AbortController` after `ms` (default 8 s). Without it, a stalled endpoint (socket accepted but no response) blocked the awaiting page-loader forever: the cursor-stepping progressive loop can't advance past a hung page, so the chart sat on "Loading…" indefinitely — the "sometimes it glitches and takes too long to load" symptom. The timeout turns a stall into a normal rejection, so the existing per-fetcher retry/backoff (Coinbase) or catch-and-return-`[]` (Binance/Bybit/Yahoo) runs and the loop exits cleanly. All four `fetchPage*` fetchers and `proxyJSON` use it. See `test/regression_fetch_timeout.mjs`.

### CORS proxy chain

`CORS_PROXIES` is an ordered array of three free relay functions (allorigins, corsproxy.io, thingproxy). `proxyJSON(url)` attempts each proxy, parses the response body as JSON (rejecting HTML error pages), and retries all three a second time after a 500 ms pause before giving up. Now only the last-resort rung: Yahoo Finance calls try direct, then `/api/market/proxy` (query1.finance.yahoo.com is allow-listed), and only fall back here (e.g. static hosting with no server routes).

### Timeframe config — `TF`

```
TF[key] = { label, menu, sec, base, bucket, pages }
```

**Custom timeframes.** The tf menu has a text input (`#tfCustom`). `parseCustomTF("45m"|"3h"|"10d"|…)` accepts m/h/d/w (bare number = minutes), clamps to 1m–4w, and picks the largest native base in `TF_BASES` (86400/21600/3600/900/300/60) that evenly divides the requested bucket. `applyCustomTF` lazily inserts a `TF["c<sec>"]` entry (section `CUSTOM`, e.g. `c2700` for 45m) and selects it, so aggregate() rolls the base bars up to the custom bucket like any built-in TF.

**Timezone selector.** Bottom-bar dropdown `#tzSel` (relocated from the topbar by `initBottomBar`) built from the full TradingView `TIMEZONES` list (~87 entries: UTC/Exchange/Local plus cities grouped by `(UTC±N)` label, incl. fractional offsets like Kolkata +5:30, Tehran +3:30). Because the selector sits at the very bottom edge of the screen, the menu opens **upward**. A CSS-only flip wasn't enough: the menu opens up into the chart area, where (a) the ancestor `#main` has `overflow:hidden` (clips it) and (b) the drawing canvas `#draw` (z-index:100, in a sibling stacking context) covers the chart — so a plain z-index couldn't escape `#main`'s context and `#draw` swallowed clicks on the upper options (the lower ones, over the bottom bar, worked). Fix: `openTzMenu()` re-parents `#tzMenu` to `<body>` as a `position:fixed` popover (`.tz-fixed`, z-index:130), measures it, and anchors it above + right-aligned to the button (clamped into the viewport); `closeTzMenu()` returns it to `#tzSel`. Selection is tracked by **index** (`tzIdx`), not offset, since many cities share one offset (so the checkmark lands on the exact city picked); `tzOffsetMin` (minutes east of UTC) is derived from the entry and applied by `tzShift(ms)`, which nudges the UNIX time so downstream `getUTC*` reads yield the selected zone's wall clock. Both `tickLabel` (axis) and `crosshairTimeFmt` (crosshair bottom tag, via `localization.timeFormatter`) route through it. `applyTz(idx)` re-applies the formatters to the main chart(s) **plus** `rsiChart` and every indicator `panes[]` sub-chart, and persists the index to `localStorage["fv_tz"]` (with back-compat: an old raw-offset value maps to the first entry with that offset). The bottom-bar chip shows the compact `UTC±N` (or UTC/Exchange/Local). Offsets are fixed (no DST math) — matching how TV labels read on a 24/7 crypto chart. Opening the menu auto-scrolls to the active entry.

**Bar-close countdown.** `#barCountdown` is a pill on the right price axis showing time until the current bar closes, TradingView-style. `updateCountdown()` (1s interval) computes the next bucket boundary via `bucketClose(now, step)` (calendar-aware: next Monday for 1W/2W, first of next month for 1M, Jan 1 for 1Y; epoch-aligned otherwise), formats via `fmtCountdown` (d/h, h:mm:ss, or m:ss), and positions the pill at `candle.priceToCoordinate(lastClose)`. Hidden when there's no data or the price is off-screen.

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

`base` is the native granularity actually fetched from the exchange. When `bucket > base` (2h, 4h, 12h, 1w, 2w, 1M, 1Y, 30m), `aggregate()` rolls the base bars up via `bucketStart(time, bucket)`: intraday buckets are epoch-aligned, but **calendar TFs match TradingView/Binance** — any multiple of 7d (1w, 2w, custom weeks) anchors to **Monday 00:00 UTC** (`WEEK_ANCHOR` = 1970-01-05; a plain epoch floor would produce Thu→Wed weeks since 1970-01-01 was a Thursday), `1M` (bucket 2592000) snaps to **true calendar months**, and `1Y` (31536000) to **calendar years**. `bucketClose(time, bucket)` gives the matching bar-close boundary (used by the countdown pill). `1M` (month) is a distinct key from `1m` (minute); the map is case-sensitive. Verified: `test/regression_calendar_buckets.mjs`.

### Per-exchange page fetchers

Each normalises its exchange's payload to the common shape `{time(sec), low, high, open, close, volume}`:

- **`fetchPageCoinbase(product, g, span, end)`** — Coinbase `[time, low, high, open, close, vol]` array, up to 300 bars, times already in seconds.
- **`fetchPageBinance(rest, g, span, end, isPerp)`** — Binance kline array, up to 1000 bars, `openTime` converted from ms to seconds.
- **`fetchPageBybit(rest, g, span, end, isPerp)`** — Bybit v5 `result.list`, up to 1000 bars, `start` converted from ms to seconds.
- **`fetchPageYahoo(sym, g, end)`** — Yahoo v8 chart endpoint; returns the full series in one call (no pagination cursor); null gaps (holidays/halts) are skipped. Routed through `fetchJSONDirectOrProxy` (direct → own proxy → public chain).

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
4. **`aggregate`** — group bars into `bucket`-second buckets via `bucketStart` (Monday-anchored weeks, calendar months/years, epoch-aligned intraday); OHLC and volume are accumulated correctly per bucket.

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
- `maSeries` — one `LineSeries` per `MAS` entry; default set is seven EMAs 7/25/99/150/200/300/400 (orange/blue/green/cyan/magenta/white/purple). The legend wraps to a new row every 4 MAs; each entry carries its own 👁 toggling that MA's `on` flag (persisted in `fv_mas`, same flag as the dialog checkbox — hidden MAs stay dimmed in the legend with 🚫 so they can be re-shown).
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

Ids come from `newId()` (`"s"+uid`). The `uid` counter is session-scoped but shapes persist with their saved ids, so `newId()` **skips any id an existing shape already holds** — without that, the first drawing of a fresh session got `s1`, colliding with a persisted `s1` and making id-based ops (object-tree selection, per-id delete via the LLM bridge) ambiguous. See `test/regression_shape_id_collision.mjs`.

### Pointer state machine

| Event | Action |
|---|---|
| `mousedown` | Axis drag (right gutter), alert-trash hit, select/drag shape (crosshair mode), begin new shape (draw mode) |
| `mousemove` | Forward crosshair to LWC (`updateCrosshair`), pan chart, drag shape/handle, track cursor for pending shape endpoint, hover hit-test |
| `mouseup` | End pan / axis drag / drag-edit; commit 2-pt shape on release; switch to click-click mode on a pure click |
| `dblclick` | Reset price scale (on axis), commit pending polyline (drops floating endpoint), open settings dialog on shape, reset scale on empty chart |
| `wheel` | Zoom anchored under cursor (keep bar under pointer fixed); shift+wheel = horizontal pan. Zoom limits are TradingView-style, driven by **bar spacing** (px/bar) via the shared `zoomSpanLimits()` helper: zoom **in** until a bar is ~`ZOOM_MAX_BAR_SPACING` (350 px) wide (≈4 bars fill the screen — the "almost infinite" zoom-in), zoom **out** until spacing hits `ZOOM_MIN_BAR_SPACING` (0.5 px) or the loaded history runs out. The same helper governs keyboard `+/-` zoom and the time-axis drag zoom, so all three agree. **Sensitivity is magnitude-scaled, not per-event** (`wheelZoomFactor()`): `factor = ZOOM_STEP ^ (deltaPx / WHEEL_NOTCH)`, so total zoom tracks total scroll DISTANCE rather than event count. This is what makes trackpads usable — a mouse fires one discrete notch (`\|deltaY\|≈100`) while a trackpad fires a high-frequency stream of small deltas, so the old sign-only `deltaY>0 ? 1.1 : 1/1.1` applied a FULL notch per tiny event and compounded (100px of scroll = 1.1× on a mouse but 1.1¹⁰ = **2.59×** on a trackpad). `isTrackpadWheel()` (pixel-mode + `\|deltaY\| < WHEEL_NOTCH`) additionally divides trackpad deltas by `TRACKPAD_DAMPING` (3), so a trackpad is 3× less sensitive than a mouse; mouse feel is bit-for-bit unchanged. `wheelDeltaPx()` normalizes `deltaMode` line/page units to px. See `test/regression_trackpad_wheel_zoom.mjs` |
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

`redraw()` runs in **two passes** so overlay content never bleeds over the right price-axis gutter (the `#draw` overlay sits *above* the chart's axis canvas and spans the full pane width, so full-width lines/drawings otherwise rendered on top of the axis labels). **Pass 1** clips the context to the plot area `[0, W−axisW()]` and draws the vertical time grid (`drawTimeGrid`), volume profile, session breaks, alert dashed lines (`drawAlertLines`), every shape in `draw.shapes` order, and any pending shape — all clipped, so grid lines and drawings stop at the axis edge. **Pass 2** (unclipped) draws only the queued right-edge price/alert pills over the gutter — deliberately **no background fill**, since the overlay is above the library's axis canvas and painting the gutter would hide the axis tick labels (the library's axis is already opaque). During pass 1, `priceTag()`, `handle()` (selection dots), and the alert right-edge tag push into `_tagQueue` instead of drawing immediately; pass 2 flushes the queue via `paintPriceTag` / `paintGutterTag` / `paintHandle` (so a handle on an endpoint sitting in the gutter stays visible and grabbable rather than being clipped). Pass 1 is wrapped in `try/finally` so a throw mid-shape can't leave the clip applied and corrupt every later frame. `drawShape(s, selected, hovered)` dispatches on `s.type` to per-type drawing functions. Selected shapes show white circle handles at each `pt`. The `extend(x1,y1,x2,y2,W,H)` helper clips a ray to the canvas boundary.

**Vertical grid — `drawTimeGrid`.** LWC's built-in vertical grid is disabled (`grid.vertLines.visible:false`) because it draws a line at ~every bar and turns into a dense grey wall on small timeframes. Instead `drawTimeGrid(W,H)` reads the visible time span (`xToTime(0)`→`xToTime(W)`), picks a "nice" step from `_GRID_STEPS` (1m…1y) so ~8–12 lines span the range, then draws one line per round boundary at `timeToX(t)` — count is bar-independent (matches TradingView). Boundaries align to the selected timezone (`tzOffsetMin`). Horizontal grid lines stay with LWC (already at price-axis labels). Sub-panes (RSI/indicators) keep LWC's grid since they're outside the `#draw` overlay. Verified: `test/audit_timegrid.mjs` (1d → 6 lines, 1m zoomed-out → 10 lines).

**Undo / redo.** `snapshotDraw()` pushes a `JSON.stringify(draw.shapes)` onto `_undoStack` (cap `UNDO_MAX=100`) and clears `_redoStack`; it's called *before* every mutation — add (finishPending/finishOneClick), delete, clone, reorder, setStyle, lock-toggle, remove-all, and drag/resize (snapshotted at drag *start*; a no-op click pops the snapshot back on mouseup so undo isn't cluttered). `undoDraw`/`redoDraw` swap between the stacks via `restoreShapes`. Bound to Ctrl/Cmd+Z (undo) and Ctrl+Y / Ctrl+Shift+Z (redo), suppressed while typing in an input, **and to the topbar ↩/↪ buttons** (`#btnUndo`/`#btnRedo`, placed after Replay). `updateUndoButtons()` — called from `snapshotDraw`, `restoreShapes`, the drag no-op pop, and at boot — greys out (`disabled`) each button when its stack is empty, matching TradingView.

**Per-drawing lock.** Each shape may carry `s.locked`. The context menu shows 🔒 Lock / 🔓 Unlock. A locked shape can't be dragged, resized, or deleted (guards in the crosshair-mode mousedown, the handle-resize path, and the Delete-key handler). Distinct from the global `draw.locked` ("Lock All Drawings") toolbar toggle.

**Stay-in-drawing-mode.** Toolbar toggle sets `draw.stay`. Normally a completed shape reverts the tool to crosshair (`selectTool("cross")`); when `draw.stay` is on, `selectTool(tool)` re-arms the same tool so the user can draw repeatedly (TradingView's "stay in drawing mode").

### Settings dialog — `openSettings` / `openFibSettings` (TradingView-parity, tabbed)

Double-clicking a shape (or "Settings…" from the context menu) opens `#settingsDlg` as a **tabbed dialog** (`Style` / `Coordinates` / `Visibility`, reusing the `.dtabs/.dtab/.dpane` CSS).

- **Generic tools** → `openSettings(id)`. The **Style** tab renders line color/width/style plus per-tool extras driven by `TOOL_CAPS[type]` (`fill` → fill color+opacity for rect/ellipse/position/etc.; `text` → text + text-color + font-size for text/callout/patterns; `arrow` → arrow-head toggle; `extend` → don't-extend/right/left/both for trend lines; `label:false` hides the price-label checkbox). The **Coordinates** tab lists one editable *(price, bar)* row per anchor point in `s.pts`. The **Visibility** tab holds the 8 TradingView time-scope toggles (Ticks/Seconds/…/Ranges) stored on `s.style.visibility`. All fields live-preview and persist. New render properties honored: `style.fillColor`, `style.textColor`, `style.fontSize`, `style.extend` (trend), `style.arrow`.
- **Fib Retracement / Extension** → `openFibSettings(id)`. Full TradingView parity. Fib config is now **per-shape** (`s.fib`, seeded by `defaultFibConfig()` on creation; legacy shapes migrate lazily via `getFib(s)`). **Style** tab: Trend line (show + color + dash), Levels line (width + dash), Extend, Reverse, show-level-values / show-prices, then the **24 default levels** (`FIB_DEFAULT_LEVELS`) each as checkbox + editable value + color in a 2-column `.fib-grid` filled **column-major** (`grid-auto-flow:column` + a per-page `gridTemplateRows` of ceil(n/2)) so values read top-to-bottom down the left column then down the right, in ascending order, plus "Use one color". The default level set spans **48 levels** (`FIB_DEFAULT_LEVELS` + `FIB_PAGE2_LEVELS`), merged and **sorted ascending** so the grid reads in order (0, 0.236, 0.382, …). Split into two fixed pages of 24: page 1 = 0→3.382 (only **0→1** checked), page 2 = 3.5→8 continuation (**all unchecked** until the user ticks them). The level grid is **paginated** by fixed 24-row slices; a ‹ / › pager (`fib_prev`/`fib_next`) swaps pages, committing edits first and remapping via each row's original `data-i` index.  **Templates** — a `Template ▾` menu in the footer offers **Save as…** (name → store to `fv_fib_templates`), **Save as default** (store to `fv_fib_default`; `defaultFibConfig()` returns a clone of it for new fibs, else `builtinFibConfig()`), **Apply defaults** (reset the shape to factory config), and each saved template (click to apply, ✕ to delete). The dialog gets a `.fib-dialog` class (wider 460px) with `overflow-x:hidden` + dark-themed scrollbars, and the level grid uses `minmax(0,1fr)` tracks so it never scrolls sideways. **Coordinates** and **Visibility** tabs as above. `drawFib` renders from the per-shape config (levels/colors/extend/reverse/one-color/trend line) instead of the old global `FIB_LEVELS`/`FIB_COLORS` (still used only as a fallback).

### Manual pan and price-axis drag

Because the overlay canvas captures all events, LWC's built-in pan/zoom is disabled. Pan is reimplemented in `startPan` / `doPan`: horizontal drag moves the time scale by `(dx / barSpacing)` bars via `scrollToPosition`; vertical drag **translates `manualPriceRange`** by the dragged pixels converted to price (`dy/h × span`), preserving the span so candle size never changes. **The back-scroll is clamped so the oldest LOADED bar can't be dragged past the left edge** (`from` floored at 0): a fast swipe can move `from` by >1000 bars in one gesture, far past the `from<200` `loadOlderHistory` trigger, so without the clamp the view scrolls into empty negative-index space — the chart blanks, then "bounces" when the lazy older-history prepend snaps it back (the reported "it bounces and takes me to the start"). Hitting the clamp also kicks off `loadOlderHistory()` so continued dragging keeps pulling in history and the wall recedes. **The same clamp guards the wheel/trackpad horizontal pan** (shift+wheel or deltaX-dominant scroll in the dcanvas wheel handler) — fast trackpad swipes hit the identical blank+bounce, especially on small TFs. See `test/regression_pan_edge_clamp.mjs`, `test/regression_wheel_pan_edge_clamp.mjs`. Unlike the old balanced-`scaleMargins` approach (bounded to [0,1]), a price-range offset has no limit — the band can be dragged arbitrarily far, like TradingView. Panning takes over the scale (auto-scale off until reset).

Right-axis vertical drag (`startAxisDrag` / `doAxisDrag`) computes an exponential zoom factor from drag distance and sets `manualPriceRange`, honoured by `candle.autoscaleInfoProvider`. Double-clicking the axis calls `resetPriceScale()` (clears `manualPriceRange`, restores auto-scale + default margins).

**Entering manual scale.** The first drag/pan calls `enterManualScale()`: it seeds `manualPriceRange` from the currently-visible range and **zeros the price-scale margins** (`_manualMargins` guard, idempotent). This is essential — with the default 0.2/0.1 margins LWC pads the range returned by the autoscale provider, inflating the rendered span; across successive vertical pans that inflation compounds (the band grows instead of translating). Zeroing margins makes `manualPriceRange` map 1:1 to the pane. `resetPriceScale` / a fresh symbol-TF load restore margins to 0.2/0.1 and clear `_manualMargins`.

**Unbounded zoom.** Two shared providers gate the right scale: `candleScale` (returns `manualPriceRange` when set, else the series' own extent) is used by `candle` and every aux chart-type series (they ARE the primary price series when their type is active); `overlayScale` (returns `null` — i.e. excluded from autoscale — when `manualPriceRange` is set) is used by the MAs and every main-pane indicator/script overlay. Without this, those overlays would merge their own data extent into the price scale and floor the visible span, blocking zoom-in. `startAxisDrag` also re-bases from `manualPriceRange` (the requested window) rather than a read-back of LWC's clamped coordinate map, so successive drags keep compounding and zoom is effectively unlimited. Compare series live on a separate `"compare"` price scale and are unaffected. Verified: `test/regression_price_axis_zoom.mjs`, `test/regression_price_pan_vertical.mjs`.

The **RSI sub-pane** gets the same axis stretch independently. It's a separate LWC chart with no `#draw` overlay, so drag handlers attach directly to `#rsi` and hit-test its own right-axis gutter (`inRsiPriceAxis`); hovering the gutter (or dragging) sets an `ns-resize` cursor. Dragging sets `manualRsiRange`, honoured by `rsiScale`, which is wired as the `autoscaleInfoProvider` on **all six** RSI-pane series (line, MA, over-fill, under, 70/50/30 bands) — not just `rsiLine`. This matters: the band lines sit at fixed 30/50/70, so if they contributed their own autoscale extent LWC would floor the merged visible range at ~[30,70] and block zoom-in. Each drag re-bases off the requested `manualRsiRange` (not a read-back of LWC's clamped view), so zoom in/out is effectively unbounded. **Overbought/oversold fills** — like TradingView, the RSI pane tints the area between the RSI line and the 70 band **teal** when RSI > 70, and between the line and the 30 band **red** when RSI < 30. Two baseline series fed the RSI values: `rsiOB` (baseValue 70, top-fill teal) and `rsiOS` (baseValue 30, bottom-fill red); each series' opposite fill is transparent so nothing shows in the neutral 30–70 zone. They're added before `rsiLine` so the line/MA draw on top, and follow the RSI plot's own visibility in `applyRsiStyle`. **LWC 4.1.3 quirk:** a fully-transparent baseline edge line suppresses that fill entirely, so the active edge line (rsiOB's top, rsiOS's bottom) carries a faint tint of the fill color rather than being transparent. Verified: `test/regression_rsi_ob_os_fill.mjs`.

`manualRsiRange` null ⇒ default 18–82 window; double-clicking the RSI axis resets to it. The RSI pane's `scaleMargins` are pinned to **4%/4%** at chart creation (LWC's 20%/10% default left big dead strips above/below and the plot floated in the middle) so the RSI fills the pane almost edge-to-edge, TradingView-style, with the absolutely-positioned `#rsiLabel` overlaying the top of the plot. Verified: `test/regression_rsi_axis_drag.mjs`.

---

## 6. Indicators

### Catalog — `IND_CATALOG`

~76 entries, each with `{type, name, cat, pane, params}`. Categories: Moving Averages, Oscillators, Momentum, Trend, Volatility, Volume, Bill Williams, Other. `pane` is either `"main"` (overlay) or `"sub"` (separate pane below `#subPanes`). "Wave 5" added the full TradingView-technicals parity set — McGinley, KAMA, Chande Kroll Stop, Linear Regression Channel, TSI, KST, RVI, SMI, Woodies CCI, Connors RSI, Ease of Movement, Klinger, Net Volume, Volume Oscillator, TWAP, Bollinger %B, Historical Volatility, Mass Index, Ulcer Index, Bull Bear Power, MA Ribbon, 52-Week High/Low. Adding an indicator = 5 edits: `IND_CATALOG` entry + `plotSpec` case (series descriptors) + `renderIndicator` case (calc → setData) + a calc function + an `IND_INFO` entry (the ⓘ explainer text). An entry may also carry `hidden:true`, which keeps it out of the Indicators dialog (`toggleIndicatorsMenu` filters on it) for types that are added from their own panel rather than picked from the catalog — currently only `pine` (§6.1).

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

MAs (default: seven EMAs 7/25/99/150/200/300/400) are held in the mutable `MAS` array (`{p, color, w, on, type, src, ls}`) and rendered directly in `renderData` via `renderMaLegend` → `maLine`. `maLine(data, m)` picks the source column (`src`: close/open/high/low/hl2/hlc3/ohlc4) and MA kind (`type`: sma/ema/wma/rma via `smaA`/`emaA`/`wmaA`/`rmaA`). They are **editable**: the `#maLegend` row ends with a ⚙ gear (`#maGear`) opening `openMaSettings` — a dialog to change each MA's type, period, source, color, width, line style, toggle visibility, add/remove, and Reset to defaults (`DEFAULT_MAS`). Add/remove rebuilds the line series via `rebuildMaSeries` (`maSeriesOpts` shares the option shape); edits persist to `localStorage["fv_mas"]` (`saveMas`). The legend label reflects the type (e.g. `EMA25`, `SMMA99`) via `maTag`. RSI(14) is rendered via `rsiSeries` / `maOfSeries` into the built-in `#rsiWrap` pane (not part of `indicators[]`). The pane is HOSTED inside `#subPanes` so it can be reordered; its label carries ⓘ info, ▁ collapse, ⚙ settings, × close (no maximize) (persisted `fv_rsi_on`; the chart's right-click menu gains "Show RSI pane" while closed) — and a `.paneResize` grip on its top border drags the pane taller/shorter (70px … 60% of window), resizing the LWC chart live.

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

### Indicator information — `openIndicatorInfo(type, name)` + `IND_INFO`

An ⓘ button on every indicator opens a read-only explainer dialog, so a user can find out what an indicator actually does without leaving the chart.

- **`IND_INFO[type]`** — hand-authored prose keyed by `IND_CATALOG` type, one entry per indicator (all ~77 covered; a missing type still yields a usable dialog). Each entry is `{what, how, use}`, rendered as the three sections **What it is** / **How to read it** / **What it's for**. The dialog header also shows the catalog category and whether the indicator draws on the price chart or in a separate pane.
- **Emphasis** — the prose uses `*asterisks*` for emphasis. `openIndicatorInfo` HTML-escapes the text **first**, then converts `*…*` to `<em>`, so the only markup ever injected is the `<em>` tags it added itself.
- **Entry points** — the button is wired in three places, all calling `openIndicatorInfo`: the generic sub-pane label (`buildIndicatorSeries`), the on-chart overlay legend row (`renderIndLegend`), and the built-in RSI pane label (`wireRsiPaneControls`, which passes the `"rsi"` type since that pane isn't an `indicators[]` entry).
- **Rendering** — the button is a `.infoBtn` span containing a plain ASCII `i`, with the circle drawn in CSS. The `ⓘ` character (U+24D8) is **not** in the app's Trebuchet MS font stack and renders as a tofu box, so it must not be used as a glyph.
- The dialog reuses the shared `#settingsDlg` element (as every other dialog here does) with an added `.info-dlg` class for its wider, prose-oriented layout; `closeDlg()` strips `info-dlg` so a subsequent settings dialog doesn't inherit it.
- **No backdrop, and draggable** — unlike every other dialog, the info panel does **not** open `#dlgBackdrop`, so the chart behind it stays fully visible and usable while it's open. It's dragged by its header instead (`makeDialogDraggable`). Two consequences that must be preserved:
  - The dialog is centred with `transform:translate(-50%,-50%)`, which cannot coexist with explicit coords — so the first drag bakes the current box into `left`/`top` and sets `transform:none`. `closeDlg()` clears all three inline styles so the next dialog re-centres.
  - With no backdrop there is nothing shielding the chart, so events landing on the dialog would otherwise *also* drive the chart's pan/zoom/crosshair handlers (dragging the dialog panned the chart underneath). `makeDialogDraggable` installs a one-time event shield on the dialog element that `stopPropagation()`s `pointerdown`/`mousedown`/`wheel`/`touchstart`/`dblclick`/`contextmenu`. Any future backdrop-less dialog needs the same shield.

---

## 6.1 Pine Editor — Pine Script v5 subset

A working subset of TradingView's Pine Script v5, interpreted in-browser. Real Pine is a proprietary compiled language, so this is a **reimplementation of the practical core**, not a port: enough to run the kind of overlay/oscillator script users actually paste in. Opened from the right rail's **Pine Editor** icon (a pyramid glyph, the slot the removed Apps stub used to occupy) as a **docked panel** (`#pinePanel`) — a flex sibling of `#main` inside `#app`, so opening it shrinks the chart to make room (rather than floating over it). It is much wider than the 300px rail dock (a code editor needs the room): default ~48vw, resizable by dragging its left edge, capped so the chart keeps ≥ 280px.

Distinct from **Freeview Script** (§7), which is a JavaScript mini-language with its own editor. Pine is the TradingView-compatible surface; Freeview Script is the raw-JS escape hatch. They share nothing.

### Pipeline — `pineTokenize` → `pineParse` → `pineRun`

- **`pineTokenize(src)`** — line-oriented lexer. Strips `//` comments (respecting string literals, so `"a // b"` keeps its slashes), emits `nl` tokens at line ends, and recognizes hex colors (`#00BFFF`) as a distinct token type. Throws `PineError(msg, line)`.
- **`pineParse(toks)`** — precedence-climbing parser. Statements are `assign` (`x = expr`, `var x = expr`) or bare `expr`; expressions cover binary ops, unary `-`/`not`, `? :` ternaries, calls with **named arguments** (`color=`, `overlay=`), dotted member access (`ta.sma`, `color.new`), and history subscripts (`close[1]`). Blocks (`if`/`for`) are deliberately **not** supported — a script is a flat statement list, which is what indicator scripts are.
- **`pineRun(src, bars)`** — evaluates against `lastData`, returning `{title, overlay, plots[], inputs[]}` where each plot is `{title, color, width, data[]}` and `data` is 1:1 with `bars`.

### Runtime semantics

A **series** is a plain JS array of length `bars.length` (`null` = Pine's `na`); a scalar is a number/string/bool. All arithmetic and comparison **broadcasts element-wise** and propagates `na` (`pineMap1`/`pineMap2`), so `close - ta.sma(close, 20)` works without the user thinking in arrays. There are no loops in the grammar, so a script is bounded at O(statements × bars) — it cannot hang the browser.

**Built-ins**: `open/high/low/close/volume/hl2/hlc3/ohlc4/bar_index`, `na`, `true`/`false`.
**Supported calls**: `indicator()`/`strategy()` (title + `overlay=`), `plot()`, `color.new()` + named colors, `input.int/float/bool/string/source/color` (returns its default; collected into `out.inputs`), `math.*`, `nz()`, and `ta.sma/ema/wma/rma/rsi/atr/stdev/highest/lowest/change/crossover/crossunder/cross`. `plotshape`/`plotchar`/`bgcolor`/`fill`/`hline` parse but are ignored (no visual equivalent wired yet). Anything else raises a line-numbered "not supported by this Pine subset" error rather than failing silently.

**`ta.*` delegates to the engine's existing math helpers** (`smaA`/`emaA`/`wmaA`/`rmaA`/`stdevA`/`highestA`/`lowestA`/`atrCalc`) rather than reimplementing them, so a Pine `ta.sma(close, 50)` is bit-identical to the built-in SMA indicator and cannot drift from it. Two hazards this creates, both handled:

- The engine's `*Calc` helpers take a **bar-field name** (`"close"`), not an array — binding `ta.rsi(high, 14)` naively to `rsiCalc(bars, len, "close")` would silently compute on close. So `ta.*` uses the **array-level** helpers (`wmaA`/`rmaA`, plus a local `rsiOn(arr, len)`) and honors its source argument.
- Some helpers (`atrCalc`) return a `{time,value}[]` that **skips its warm-up bars**, so it is *not* index-aligned with `bars`. Indexing it directly would shift the plot left by `len-1` bars. `byTime()` re-aligns by timestamp into a full-length array.

### Bridge to the indicator system — `pineCompile(ind)`

A Pine script runs as a real indicator (`IND_CATALOG` type `pine`, marked `hidden:true` so it never appears in the Indicators dialog — it's added from the editor, which supplies `params.src` + `params.name`). This buys persistence, the legend, sub-panes, the Object tree and removal **for free**, with no parallel rendering path.

- **`pineCompile(ind)`** runs the script and caches `{plots, overlay}` onto `ind.params`; on a throw it stores `ind.pineError` and keeps the last-good plots (so a script restored for a symbol with no data yet degrades instead of exploding).
- **`addIndicator`** compiles up-front and overrides `ind.pane` from the script's own `overlay=` (`true` → `"main"`, `false` → `"sub"`) and `ind.name` from its `indicator()` title — `pane` can't be a static catalog field because it's a property of the source.
- **`plotSpec`** returns one line spec per `plot()` call (count/colors/widths from the script). **`renderIndicator`** re-runs `pineCompile` on every paint, so plots track new bars, symbol switches and timeframe changes, then `setData`s each plot onto its series.
- **`indParamSummary`** returns `""` for `pine` — the generic path joins every param, which for a Pine script would render `(…, [object Object],[object Object], true)` in the legend. The script name is the whole label.
- **`openIndicatorSettings`** routes `pine` to `openPineEditorWith(ind)` — a Pine script's "settings" are its source, and the generic Inputs/Style dashboard would try to render number inputs for `params.src` and `params.plots`.

### Editor panel — `openPineEditor(preset?)`

A docked panel (`#pinePanel`) — TradingView's Pine Editor layout: a header (widen-toggle ⤢ / close ✕), a toolbar (script-name dropdown + **Add to chart** + **Save**), a code area with a line-number gutter, an inline error line, and a status bar (`Added to chart` / caret `Line N, Col N` / `Pine Script® v5 subset`). It sits between `#main` and the watchlist in the flex row, so its width comes out of the chart's.

- **Code editor** — a transparent `<textarea>` (`#pineCode`) layered over a syntax-highlighted `<pre>` (`#pineHl`): the textarea owns the real caret/selection/IME and scrolling; the `<pre>` underneath is painted by `pineHighlight(src)` and shows through the transparent text. The two layers **must** share identical font/size/line-height/padding/`white-space:pre`/`tab-size` or the colors drift out from under the caret — a browser test (`verify`) asserts their `scrollHeight`/`scrollWidth` match. A line-number gutter (`#pineGutter`, `white-space:pre` so numbers stack one-per-line) and the `<pre>` follow the textarea's scroll (gutter via `transform`, since it has no scrollbar). `Tab` inserts four spaces.
- **`pineHighlight(src)`** — single-pass regex highlighter (comments/strings matched first so they swallow code-looking text inside them). Everything is HTML-escaped *before* any markup is added, so source text can't inject HTML; the only styled-from-token markup is the inline color swatch, which the regex restricts to a hex literal. Token classes: `t-kw` (keywords), `t-fn` (dotted calls `ta.sma`), `t-var` (OHLCV builtins), `t-str`, `t-num`, `t-com`, `t-bool` (`true`/`false`/`na`), `t-col`+`t-sw` (hex color + its inline chip).
- **Docking + width** — `#pinePanel` is `display:none` until `.open`; opening it (`openPineEditor`) shows the flex child, so the chart (`flex:1`) reflows narrower, then calls `resize()`/`sizeCanvas()` to re-fit the LWC canvas. Opening also adds `html.pine-open`, which **hides the watchlist and any docked rail panel** (`#watchlist`/`#rightPanel`) — the editor takes over that whole zone; only the chart + Pine + the icon rail (`#rightRail`) remain. Width is a persisted CSS var `--pine-w` (`fv_pine_w`, default `48vw`). `#pineResize` on the **left edge** drags it wider/narrower; `pineMaxWidth()` clamps the drag (and the ⤢ toggle) so the chart never drops below `PINE_MIN_CHART` (280px) — the cap is computed from the chart's own width, not the raw viewport, because the toolbar/rail also take fixed space. `#pineMax` (⤢) toggles between the current width and the max, remembering the pre-widen width (`_preWide`) to restore it. `closePineEditor` removes `.open` + `pine-open` (the watchlist returns) and re-fits the chart to full width. The rail button **toggles** the panel (`pineRailToggle`); it is **excluded from the boot re-open** (`fv_rail_active`) so a wide editor doesn't reclaim half the chart on every reload.
- **Saved scripts** — the script-name button (`#pineNameBtn`) opens a dropdown (`#pineMenu`) listing saved scripts (click to load, ✕ to delete) plus **+ New script…**. Scripts persist to `localStorage["fv_pine_scripts"]` (`{name: src}`); `fv_pine_last` remembers the last-edited one so the window reopens where you left off.
- **Naming** — the window title follows the script's own `indicator()` title on compile **unless** the user has explicitly named it (picked/typed a name, or Saved) — tracked by the `named` flag against the `PINE_PLACEHOLDER` default. This matches TradingView (the window is titled by the script) and avoids silently saving every new script as "My Script".
- Compile errors surface inline as `Line N: message`, never as a thrown exception. `openPineEditorWith(ind)` opens the window preloaded with an on-chart script (the ⚙ on its legend row).

### Tests — `web/app/home/wallet/pine.logic.test.mjs`

Runs the **shipped** interpreter, not a copy: the test slices the `// PINE-CORE-START … // PINE-CORE-END` block plus the engine math helpers it depends on straight out of `web/public/index.html` and evaluates them in a `node:vm` context. If the markers or helpers move, the test fails loudly instead of passing against a stale duplicate. **Keep those markers, and keep that range free of DOM access.** Covers: the golden 4-SMA script (values vs an independent reference SMA, `na` warm-up, exact `color.new` → rgba), `overlay=false` → sub-pane, `ta.*` honoring its source argument, `ta.atr` time-alignment, series arithmetic/`na` propagation, `series[n]` history + ternaries, line-numbered errors, `//` inside strings, and `input.*` defaults.

---

## 7. Freeview Script (Wave 4)

A sandboxed mini custom-indicator language. The user writes a JavaScript body in the `#scriptDlg` editor. The engine evaluates it against the current bar data and renders the results as live series.

### Execution — `runScript(code, data)`

0. **Pine v5 basic subset**: if the source looks like Pine (`looksLikePine` — a `//@version=5` header or an `indicator()`/`strategy()` declaration), `transpilePine()` converts it to JS first. It's a real tokenizer + recursive-descent parser emitting calls into a runtime prelude (`PINE_PRELUDE`, prepended to the output): `__op` gives element-wise series arithmetic/comparisons/`and`/`or`, `__tern` element-wise ternary, `__hist` history refs (`close[1]`), `__pta` adapts Pine `ta.*` signatures (incl. a generic `rsi(src,len)` the JS `ta` lacks), `__input` collapses `input.*()` to its default, `__decl` maps `indicator(…, overlay=…)` to the default pane, and `__plot/__plotshape/__hline` translate named args (`color=color.red`, `#7E57C2` hex literals, `linewidth`, `location.*`, `color.new()`). Control flow (`if`/`for`), `var`/`varip`, user functions, tuples and `request.security` are outside the subset and raise a descriptive error. Pine source persists as-is (`fv_scripts_<sym>`); transpilation happens at run time.
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
  interval,  // TF key ("1m"…"1Y") the indicator is computed on | null = chart TF
  trigger,   // "once" | "every"
  expiry,    // epoch ms | null
  message,
  notify: { popup, sound, browser, email },
  sound: { kind, id },   // kind: "sound" | "ringtone"; id from ALERT_SOUNDS / ALERT_RINGTONES
  webhook,   // user-defined URL | "" — POSTed on trigger (no backend needed)
  active, _last
}
```

`source` and `target` are keys from `ALERT_SOURCES`: `"price"`, `"ma7"` through `"ma300"`, `"rsi"`. `op` is one of `crossing | crossUp | crossDown | gt | lt`. The dialog's **Interval** row (`#ad_interval`, hidden for price/drawing sources) pins the indicator to a timeframe. New alerts default the dropdown to the chart's `activeTF` (not a vague "same as chart"), and save resolves empty → `activeTF`, so every indicator alert stores a CONCRETE TF that shows in its label and doesn't silently drift when the chart TF later changes. `loadAlerts()` backfills any legacy indicator alert with `interval:null` to `activeTF` (non-destructive, persisted) so pre-feature alerts also carry a timeframe. Price/drawing alerts keep `interval:null`.

### Evaluation — `checkAlerts` / `alertTriggered`

Called from `renderData` on every paint. `sourceValue(key, data=lastData)` computes the current value of each source. `alertSourceValue(a, key)` is the interval-aware wrapper: when `a.interval` is set (and isn't the active TF), it evaluates on that TF's candles from `alertIntervalBars(tf)` — a per-`SYM|tf` cache (`_alertTfBars`, LRU-capped at 12) filled by `fetchTfBars` and refreshed stale-while-revalidate at most every 30s, only while such an alert is being checked; `withLiveTail()` patches the cached forming bar with the live tick between refetches, and a completed refetch re-runs `checkAlerts()` once. `alertTargetValue(a)` resolves the RHS (a fixed number or a source value, same interval rules). `alertTriggered` uses `a._last` (the previous LHS-minus-RHS difference) to detect sign changes for crossing ops; level ops (`gt`/`lt`) fire on current state. Expired alerts are deactivated; "once" alerts deactivate after firing.

### Firing — `fireAlert`

On trigger: browser `Notification` (if permission granted and `notify.browser`), in-app toast div (clickable to dismiss, 7-second auto-remove) if `notify.popup`, and the alert's chosen tone via `playAlertSound(a.sound)` if `notify.sound`. The toast is positioned `right:320px` (clear of the watchlist panel) on desktop; viewports narrower than 700px (phone WebViews) get `left:10px;right:10px` so it spans the screen instead of collapsing against the offset (regression: `test/regression_alert_toast_mobile_fit.mjs`, viewport 360×780). If `a.webhook` is set, a fire-and-forget `fetch()` POSTs `{symbol, message, value, source, op, target, time}` JSON to that URL (`mode:"no-cors"`, `keepalive:true`) — no backend required, works from any static host. Email requires a backend and is silently no-op.

### Sound engine — `playAlertSound` / `ALERT_SOUNDS` / `ALERT_RINGTONES`

Mostly WebAudio synth (works offline). Two families: `ALERT_SOUNDS` — 20 short one-shots (each a `gen(ac,dst,t)` generator built from `_tone`/`_melody`); `ALERT_RINGTONES` — 20 synth melodies looped by `_melody(..., {minDur:RINGTONE_MIN_SEC})` to run ≥10s, PLUS **file-based** ringtones with a `src` (real audio via `new Audio(src)`): `route1` (loops) and `zelda` (`playFull:true`). A file ringtone default-loops (`el.loop=true`) until dismissed; `playFull` plays ONCE through to the end (`el.loop=false`, self-clears `_activeRing` on `onended`) and is NOT cut by the popup's 7s auto-close or the no-popup 12s stop — only an explicit popup click stops it early (for tunes meant to be heard in full, e.g. Zelda at ~13s). A single shared `AudioContext` (`alertAC()`) is reused for synth tones. `playAlertSound({kind,id})` returns a handle with `.stop()` (+ `.playFull`); ringtones register in `_activeRing` (one at a time), halted by `stopAlertSound()`. The dialog's **Alert sound** row (`#ad_sound_kind` selector + `#ad_sound_id` list + Preview/Stop) lets the user pick/audition; selection saves as `sound:{kind,id}`. **Defaults** (`ALERT_DEFAULT_SOUND` / `ALERT_DEFAULT_NOTIFY`): new alerts default to the **Zelda ringtone** with **App popup + Sound** checked. Regression: `test/regression_zelda_ringtone.mjs`.

### Visual — `drawAlertLines` / `updateRsiAlertLines`

For `price`-vs-`value` alerts, `redraw` calls `drawAlertLines()` (skipped entirely when `alertLinesVisible` is false) which draws a dashed horizontal line at `priceToY(a.value)` — colored `alertLineColor` (default white `#ffffff`) for active alerts — and (on hover) an on-line pill showing the FULL condition label via `defaultAlertMessage(a)` (e.g. "SYM Price Crossing 0.3955", matching the RSI-pane pill — not just the bare number) plus a clickable vector trash icon; the pill is RIGHT-ALIGNED against the plot edge (4px left of the price axis, clamped to x≥6 on very narrow plots) so the axis gutter and its last-price badge stay fully visible while hovering (regression: `test/regression_alert_pill_position.mjs`). `alertHitboxes[]` stores `{id, y, trash, pill}` for mouse hit-testing (`alertHit`, `alertTrashHit`, `alertPillHit`). Grabbing a line OR its pill (cross mode) starts `draw.alertDrag`; dragging re-prices the alert via `yToPrice` and persists on mouseup — but HOLDING on the pill without moving (long-press, 450ms `_pillPressTimer`, cancelled by movement >3px or mouseup via `clearPillPress`) cancels the drag and opens `showAlertMenu` instead (phone flow: drag finger over the line → pill appears → hold it). The same menu is on right-click: Pause/Resume, Edit… (`openAlertDialog({existing})`), Delete. The "Change alerts color…" item was REMOVED (owner request); a previously saved `fv_alert_color` in localStorage is still honored by `alertLineColor`. The old "Alert lines" visibility toggle was also REMOVED (owner: redundant — an alert without its line is invisible); `alertLinesVisible` is now hardwired true and stale `fv_alert_lines="0"` in localStorage is ignored. On touch, tapping a line shows its pill and a press anywhere else dismisses it (no mousemove between taps to clear the hover — regression: `test/regression_alert_pill_tap_away.mjs`).

**Crosshair ⊕ add-alert** (`drawCrossPlus`, called from `redraw` after `drawAlertLines`): while the cursor/finger is on the plot in cross mode (and no drag/pan/pending-shape/hover-pill owns the pointer), a small dark ⊕ button (r=8, pill palette `#1e222d`/`#9aa0aa`) rides the crosshair Y just left of the price axis (`crossPlusHit={x,y,r,price}`; cross-mode mousemove always repaints so it tracks). Mousedown on it IMMEDIATELY calls `addQuickAlert(price)` — no intermediate menu — creating a source:price / op:crossing / target:value alert at that price with all defaults (once, no expiration, default notify+sound), then `saveAlerts`+`checkAlerts`+`toast`. Editing happens afterwards via the pill long-press menu. On phones the touch bridge makes this work naturally: dragging a finger shows the crosshair + ⊕ (synthetic mousemove), the ⊕ persists after lift (no mouseleave on touch), and the next tap hits it. Regression: `test/regression_crosshair_plus_alert.mjs` (⊕ appears, tap adds directly with defaults + no menu, pill long-press → Pause/Edit/Delete).

**RSI-pane crosshair ⊕** — the RSI sub-pane has NO overlay canvas (it's pure LWC: series + native `createPriceLine` alert lines), so its ⊕ is an HTML element `#rsiCrossPlus` (sibling of `#rsiAlertPill` inside `#rsiWrap`), not a canvas draw. The RSI mousemove handler (near `rsiAlertHit`) positions it at the cursor Y (`right:rsiAxisW()+5`) and shows it while `draw.tool==="cross"` and the cursor is inside the RSI plot, not over the axis gutter (`inRsiPriceAxis`), and not over an existing alert line (the on-line pill wins). Mousedown calls `addQuickRsiAlert(v)` where `v = clamp(rsiLine.coordinateToPrice(y), 0, 100)` — builds a **source:"rsi"** / op:crossing / target:value alert (interval = `activeTF`, like the RSI context-menu path) and `saveAlerts()` redraws the native RSI line via `updateRsiAlertLines()`. Mouse-only for now (touch quick-RSI-alert still goes through the pane right-click menu). Regression: `test/regression_rsi_quick_alert_plus.mjs` (⊕ visible on RSI hover, click adds a source:"rsi" alert + native line). The `dcanvas` `mouseleave` handler now ALWAYS calls `redraw()` (previously only when a hover/alertHover was active) so the main-pane ⊕ is erased the instant the cursor leaves the plot — e.g. dropping into the RSI/indicator pane — instead of staying painted (`drawCrossPlus()` returns early with `draw.mouse=null`). Regression: `test/regression_crossplus_clears_offplot.mjs` (`crossPlusHit` null after leaving the plot into the RSI pane and after leaving the chart entirely). The RSI ⊕ also dead-zones the top/bottom `EDGE=7px` of the pane so it never renders on top of the pane-resize grip (`.paneResize`) at the pane border — it disappears crossing that intersection and reappears once the cursor is clearly inside the plot.

For `rsi`-vs-`value` alerts, `updateRsiAlertLines()` creates native lightweight-charts price lines (dashed, `alertLineColor`, 🔔 title) on the `rsiLine` series in the RSI pane — the canvas `drawAlertLines` only covers the main pane, so without this an RSI alert was created but invisible. The price line is created with `axisLabelVisible:false` — the dashed line stays visible but its right-axis 🔔/value pill is **hidden by default** (keeps the gutter clean, matching the main pane's hover-only tag); `showRsiAlertPill`/`hideRsiAlertPill` flip `axisLabelVisible` true/false as the line is hovered. Lines are tracked in `rsiAlertLines[]` as `{id, pl}` and rebuilt by `saveAlerts()`, `loadAlerts()`, and the "Alert lines"/color menu items; inactive alerts render gray (`#888`); they honor `alertLinesVisible`. **Drag-to-move** (`rsiAlertDragStart/Move/End`): `rsiAlertHit()` hit-tests ±6px around each line's `rsiLine.priceToCoordinate(a.value)` (axis gutter excluded so the axis-stretch drag keeps priority); grabbing a line starts `rsiAlertDrag`, move re-values via `rsiLine.coordinateToPrice` (clamped 0–100, live `pl.applyOptions({price})`), release persists via `saveAlerts()`. Bound for BOTH mouse (`mousedown`/`mousemove`/`mouseup`) and touch (`touchstart`/`touchmove`/`touchend`/`touchcancel`, `passive:false` + `preventDefault` so the pane doesn't scroll mid-drag) via `rsiPointerPt()` — this is the only touch-drag in the engine, added because the mobile app embeds it on a phone with no mouse. Cursor uses the class-based trick (`#rsi.alert-hover` / `html.rsi-axis-drag`) because the LWC canvas sets its own inline cursor. **Hover pill**: hovering a line shows `#rsiAlertPill` (a DOM pill absolutely positioned inside `position:relative` `#rsiWrap`) with the alert's `defaultAlertMessage(a)` text + a clickable 🗑 — the RSI-pane equivalent of the main pane's on-canvas pill (`showRsiAlertPill`/`hideRsiAlertPill`, `_rsiPillId`). **Right-click**: a capture-phase `contextmenu` on `rsiEl` hit-tests the line and, when hit, calls the shared `showAlertMenu(id,x,y)` (Pause/Resume, Edit…, Delete, Alert-lines toggle, color) — capture phase so it runs before `attachPaneContextMenu`'s bubble handler, which otherwise shows the generic "Add alert on RSI" pane menu; a right-click NOT on a line falls through to that pane menu. Other sub-pane sources (macd, atr, cci, willr, volume) still have no pane line — their panes are dynamic per-indicator subCharts. Regressions: `test/regression_rsi_alert_line.mjs`, `test/regression_rsi_alert_interval_drag.mjs` (drag, touch-drag, hover pill, context menu).

---

## 9. Persistence (localStorage)

| Key pattern | What is stored | Written by | Read by |
|---|---|---|---|
| `fv_watchlist` | `GROUPS[]` — array of `{name, symbols[], collapsed?}` | `saveGroups()` | `loadGroups()` at boot |
| `fv_wl_reset_v3` | `"1"` — one-time stamp; presence means the comeback-list default reset already ran | `migrateComebackDefault()` | same (guard check at boot) |
| `fv_draw_<symbol>` | `draw.shapes[]` — array of `{id, type, pts, style, text?}`. Keyed **per symbol only** (not per TF): shape points store absolute time+price, so a drawing made on any timeframe shows on every timeframe of that symbol. `loadPersisted()` runs a one-time `migrateLegacyDraw()` that merges any legacy `fv_draw_<symbol>_<tf>` entries into this key (deduped by shape id) and deletes them. | `persist()` | `loadPersisted()` on symbol/TF change and at boot |
| `fv_scripts_<symbol>` | `[{name, code}]` — user script name and source | `saveScripts()` | `loadScripts()` on symbol change and at boot |
| `fv_alerts_<symbol>` | `[{id, source, op, target, value, trigger, expiry, message, notify, sound, webhook, active}]` | `saveAlerts()` | `loadAlerts()` on symbol change and at boot |
| `fv_alert_lines` / `fv_alert_color` | alert-line visibility (`"1"`/`"0"`) + hex color | context-menu toggles | read at boot into `alertLinesVisible` / `alertLineColor` |
| `fv_recent_wl` | `RECENT_WL[]` — watchlist names, most-recent-first (drives the list-menu RECENTLY USED section) | `pushRecentWL()` on every `switchWatchlist` | read at boot |
| `fv_indicators_<symbol>` | `[{type, params, hidden}]` — active indicators | `saveIndicators()` on add/remove/hide/settings | `loadIndicators()` on symbol change and at boot |
| `fv_active_symbol` / `fv_active_tf` | last-viewed symbol + timeframe key | `saveActiveState()` on symbol/TF change | read at boot (before first `loadChart`); `validateRestoredTF` rebuilds a custom `c<sec>` TF entry or falls back to `1d` |
| `fv_tz` | selected `TIMEZONES` index (back-compat: legacy raw offset accepted) | `applyTz()` | read at boot |

| `fv_ind_favorites` | array of catalog `type` keys starred in the indicators dialog | `saveFavorites()` | read at boot |
| `fv_pine_scripts` | `{name: source}` — saved Pine Editor scripts (§6.1) | `pineSaveScript()` on Save / Add to chart | `openPineEditor()` (saved-scripts dropdown) |
| `fv_pine_last` | name of the last-edited Pine script — the editor reopens it | `openPineEditor` Save / Add to chart / dropdown change | `openPineEditor()` at open |
| `fv_pine_w` | docked Pine panel width (CSS `--pine-w`, e.g. `48vw` or `720px`) | `pineSetWidth()` on resize / ⤢ | `openPineEditor()` at open |
| `fv_wl_hidden` | array of legs whose watchlist price cells are masked as `••••••` (the per-row eye toggle) | `saveWlHidden()` | boot into `WL_HIDDEN` set |
| `fv_alert_log` | `ALERT_LOG[]` — fired-alert history (`{ts, symbol, text}`) | `logAlert()` / `clearNotifications()` | boot; Notifications panel |
| `fv_notif_seen` | timestamp of last Notifications-panel open (drives the unread bell badge) | `openNotificationsPanel()` | `notifUnreadCount()` |
| `fv_wl_width` | right-sidebar width in px (`--wl-w`) — shared by the watchlist and the docked rail panel | `#wlResize` **or** `#rpResize` drag (`wireSidebarResize`) | boot |
| `fv_flags` | `SYMBOL_FLAGS` — symbol → hex flag color | `setSymbolFlag()` | boot |
| `fv_rsi_on` | built-in RSI pane visibility ("0" = closed via the pane's ×; restored via chart right-click → "Show RSI pane") | `hideRsiPane()` / `showRsiPane()` | boot |
| `fv_mas` / `fv_rsi_params` | editable MA set / RSI params + style | `saveMas()` / RSI settings | boot |
| `fv_layout` / `fv_layouts_named` / `fv_grid_sync` | active grid layout + per-panel symbols / named layouts / SYNC-IN-LAYOUT toggles | `persistLayout()` / `saveNamedLayout()` / grid-sync toggles | boot |
| `fv_watchlists` / `fv_active_wl` | all named watchlists / active name | `saveWatchlists()` | boot (legacy `fv_watchlist` migrated) |

| `ov_trades` | `Trade[]` — the trade journal (see §15). Written by the **Next app**, not the engine, hence the `ov_` prefix rather than `fv_`. | `saveTrades()` / `addTrade()` in `app/home/journal/trades.ts` (via the right-click → Add Trade modal) | `loadTrades()` in `app/home/journal/trades.ts` |
| `ov_notes` | `Note[]` — the notes board (see §15). Sorted pinned-first, then most-recently-updated. | `addNote()` / `updateNote()` / `deleteNote()` in `app/home/journal/notes.ts` | `loadNotes()` (same file) |
| `ov_holdings` | `Holding[]` — wallet portfolio (see §16). Fields are Reach's snake_case (`asset_type`, `avg_buy_price`) so holdings stay portable with the desktop app. Purchase detail — `purchased_at` (epoch ms), `fee_pct` (percent of trade value, defaults to 0.5 on a new entry), `notes` — is **optional**: records written before those fields existed simply lack them, so nothing needs migrating and no reader may assume they're present. The **dollar** fee is derived at render time from `amount × avg_buy_price × fee_pct`, never stored — a stored figure would go stale the moment either input changed. With multi-portfolio (below) this key holds the **"main" portfolio's** holdings; additional portfolios live under `ov_holdings__<id>`. The zero-arg `loadHoldings()`/`addHolding()`/… operate on whichever key `setActiveHoldingsKey()` last pointed at (the active portfolio), so callers are unchanged. | `addHolding()` / `updateHolding()` / `deleteHolding()` in `app/home/wallet/holdings.ts` | `loadHoldings()` (same file) |
| `ov_portfolios` | `{portfolios: [{id,name}], activeId}` — the multi-portfolio index (see §16). Created on first run from the legacy single `ov_holdings` list, which becomes the `main` portfolio; `ov_holdings` is **never** moved or deleted, so a downgrade still finds the user's original holdings. Each non-main portfolio's holdings live under `ov_holdings__<id>`. Switching/creating/deleting repoints `holdings.ts` at the active key via `setActiveHoldingsKey()`. | `createPortfolio()` / `renamePortfolio()` / `deletePortfolio()` / `setActivePortfolio()` in `app/home/wallet/portfolios.ts` | `ensurePortfolios()` / `loadPortfolios()` / `getActiveId()` (same file) |
| `ov_portfolio_snapshots` | `Snapshot[]` (`{t, value}`) — portfolio-value time series backing the History chart **and the header's 24h change** (`valueAgo(snapshots, 24)`). Appended on each successful price poll, throttled to one per 5 min, capped at 26k points. Reach stores these in SQLite; with no server DB they live here, which is why the chart shows "Collecting data" until two polls land — and why a fresh wallet's 24h change reads "—" until the series reaches back a day. | `recordSnapshot()` in `app/home/wallet/holdings.ts` | `loadSnapshots()` / `valueAgo()` (same file) |
| `ov_tracked_wallets` | `TrackedWallet[]` (`{id, address, chain, label?}`) — on-chain addresses watched by the Wallet Tracker (see §16). Seeded with the 231 known whale/exchange wallets in `DEFAULT_WALLETS` (~20 per chain on the original 10 chains, plus live-verified whale seeds on the newer chains) **only when the key has never been written** (`raw === null`); an explicitly-stored `[]` is honoured as empty, so a user who clears the list doesn't get them all back on reload. When the seed set itself changes, `SEED_VERSION` drives a migration that swaps stale seeds for current ones while preserving user-added rows (§16). | `saveTracked()` in `app/home/wallet/chains.ts` | `loadTracked()` / `defaultWallets()` (same file) |
| `ov_tracked_seed_version` | `number` — which generation of `DEFAULT_WALLETS` the stored list was seeded from. Absent/`1` = Reach's original 20; `2` = the 173-wallet set; `3` = adds hyperliquid/cardano/sui/bittensor/injective (+8 verified seeds); `4` = adds Hedera and fills the new chains' seeds to 231 total. Lets an existing user pick up a new seed set without losing wallets they added themselves. | `saveTracked()` (same file) | `loadTracked()` (same file) |

*(Not every key above is exhaustive — chart-settings/tool-favorite/template keys also exist; this table covers the durable app state a reader is most likely to look up.)*

**Watchlist import/export** — `exportWatchlist()` downloads a `.txt` in `###SECTION` + symbols-per-line format; `importWatchlistText(txt)` parses it back into `GROUPS`, saves, and rebuilds. Buttons ⭱/⭳ in `#wlHead`.

**Session breaks** — `drawSessionBreaks(W,H)` (in `redraw`) draws faint vertical lines at each tz-adjusted day boundary, but only on intraday timeframes (`tfStepSec() < 86400`); daily+ early-returns. Also gated on visible span: skipped when the view spans >15 days, so a zoomed-out 4h/6h/12h chart doesn't render one line per day (a grey wall) — beyond that window `drawTimeGrid` provides the round-interval grid instead.

**Volume Profile** — a `pane:"overlay"` catalog indicator that toggles `window.volProfileOn` instead of creating a LWC series (handled specially in `addIndicator`/`removeIndicator`). `drawVolumeProfile(W,H)` (in `redraw`) bins the visible bars' volume into 40 price buckets and draws a horizontal histogram on the left edge, highlighting the POC (highest-volume) bucket in orange. The floating legend (`#chartLegend`) has a `#legCollapse` chevron that toggles `.collapsed` to hide the MA/indicator rows.

**Screenshot / fullscreen** — 📷 `saveScreenshot()` composites `chart.takeScreenshot()` (main chart canvas) with the `dcanvas` drawing overlay onto one canvas → PNG download `freeview-<symbol>-<tf>.png` (sub-panes not included). ⛶ `toggleFullscreen()` requests/exits fullscreen on `#app` and re-runs `resize()`/`sizeCanvas()` on `fullscreenchange`.

**Keyboard shortcuts** (in the window `keydown` handler, skipped while typing): Arrow ←/→ pan the time axis (`scrollToPosition ±3`), `+`/`-` zoom the visible logical range (×1/1.2 / ×1.2), `Alt+H` drops a horizontal line at the crosshair price. (Esc cancels, Del deletes selected, Ctrl+Z/Y undo/redo — see drawing engine.)

**Top toolbar** (`#topbar`, 38px) — TradingView order with thin `.tbdiv` dividers: symbol search (`#symbolBox`) │ interval (`#tfSel`) │ chart type (`#ctSel`) │ Indicators · Alert · Script, then a `.tbspacer` (flex:1) pushes screenshot + fullscreen + live status to the right. `.tbtn` buttons are 28px tall with a rounded `#2a2e39` hover pill. **Icons are inline stroke SVGs, not emoji** — search, Compare, Indicators, Alert, Script, screenshot, object-tree, settings, fullscreen, Replay, and the watchlist-header import/export/add all use `<svg viewBox="0 0 24 24">` paths styled by a shared rule (`.tbtn svg, .wlActions svg, #symSearchIcon svg`: 15px, `currentColor` stroke 1.7). Emoji rendered inconsistently (tofu boxes) across platforms; SVGs match the rail `ICON` set and inherit hover color. Icon-only buttons carry `.icon-only` (tighter padding). The scale toggle + timezone selector live in the HTML here but are re-parented to the bottom bar at boot.

**Bottom bar** (`#bottomBar`, TradingView-style) — spans the base of the chart column. Left: `#rangeShortcuts` date-range buttons (1D 5D 1M 3M 6M YTD 1Y 5Y All); each calls `applyRange(r)` which converts the target start time to a logical bar index and calls `setVisibleLogicalRange`. Right: `#bottomRight` holds the timezone selector (`#tzSel`) and scale toggle (`#btnScale`), relocated there from the top toolbar at boot by `initBottomBar` (which just re-parents the existing wired DOM nodes). YTD uses the tz-adjusted Jan-1; All spans the full loaded history.

**Floating on-chart legend** (`#chartLegend`, TradingView-style) — a semi-transparent box pinned top-left over the chart (inside `#chartWrap`), holding three stacked rows: `#legSymRow` (symbol · tf · exchange + OHLC), `#maLegend` (the six MAs, colored, tabular-nums), and `#indLegend` (one row per added indicator with eye/gear/× + hover value). The symbol row is synced in `loadChart`; OHLC via `updateOhlcLegend`. These values were moved off the top toolbar (which now holds only controls) to match TradingView. **`updateOhlcLegend(time)`** finds the bar nearest the crosshair (or the latest bar on load, from `renderData`) and renders `O H L C` plus the **change** (abs + %) vs the previous close, green/red.

**Symbol search** — the top-bar symbol name (`#symbolBox`, with a 🔍 icon) is clickable → `openAddSymbolDlg(null)`, opening the `#symDlg` search modal (categories All/Coinbase/Binance/Bybit/Stocks/Spread, live-filtered, keyboard-navigable; the Spread tab builds an A/B ratio leg). Right-clicking it opens `showSymbolInfo` — a popover with the symbol's structured details (symbol, exchange/type or numerator/denominator for ratios, base/quote, timeframe, last).

**Infinite scroll-back** — `chart.timeScale().subscribeVisibleLogicalRangeChange` fires `loadOlderHistory()` when the view's `from` index drops below **200** (a wide lead so the multi-second fetch, on slow networks, starts well before the user pans into the left edge — scrolling back feels continuous instead of "hit a wall, wait, then load"). It fetches a few older pages via `fetchOlderPages(leg, tf, oldestTime, pages)` (both legs re-`makeRatio`'d for spreads), prepends the bars to `lastData`, repaints with `keepView`, and shifts the visible logical range by the prepended count so the view doesn't jump. **Fetch depth is venue-aware** (`_pages`): Binance/Bybit return 1000 bars/page, so 2 pages (2000 older bars) is plenty per swipe and lands in ~half the round-trips; Coinbase caps at 300/page so it fetches 4. Repeated triggers (fired by the pan clamp above when the user keeps dragging into the wall) deepen further on demand — this keeps each prepend fast instead of stalling on a deep multi-page fetch. Guards: `_loadingOlder` (in-flight) and `_historyExhausted` (a short page = start of history, or the 50k-bar `MAX_BARS` ceiling is reached — the older batch is trimmed so `lastData` never exceeds 50k), both reset on symbol/TF change in `loadChart`. The stale-prepend abort compares `sym`/`tf` only — deliberately NOT `loadToken`, because the silent 20s poll bumps the token too and keying on it silently discarded in-flight scroll-back prepends (~1 in 4 on slow networks — read as "loading slow"). **The 20s background refresh preserves this deepened history**: `paintFinal` splices the fresh (default-depth) fetch onto the older tail already in `lastData` (bars older than the fresh fetch's oldest are concatenated back on) instead of replacing wholesale — otherwise the shorter refetch would shrink the series and strand a scrolled-back view off the left end (the "it bounces back to the start" bug). See `test/regression_scrollback_refresh_merge.mjs`.

**Bar replay** — the ⏮Replay button arms a picker; clicking a bar sets `_replay.idx`. While `_replay.active`, `renderData` keeps the full series in `_replay.full` but slices `lastData` to `_replay.idx`, so only history up to the cursor shows. The `#replayBar` (⏪ step-back / ▶ play-pause / ⏩ step / position / ✕ exit) drives `replayStep`/`replayPlay` (400ms auto-advance). Exit reveals the full series and re-snaps.

**Object tree / Data window (docked)** — the 🗂 topbar button and the rail's layers icon open the Object tree DOCKED in the right sidebar (`openObjectTreePanel` → `openDock("objtree", …)`), with two pill tabs (`.rp-tabs`): **Object tree** and **Data window** (`_otTab`). The tree (`renderObjectTree` into `#otContent`) lists the chart-symbol row (`otSymbolLabel()`: sym · exchange, TF), each indicator (+`indParamSummary`) and script, then every drawing topmost-first with a per-type thin-line icon (`shapeIcon`) and name (`s.name || prettyType(s.type)`). Row hover shows inline lock / eye / delete (`.ot-acts`; pinned visible while locked/hidden): lock toggles `s.locked`, eye toggles per-shape `s.hidden` (greyed row + slashed eye; `redraw` and `hitTest` skip hidden shapes), delete routes to `deleteShape`/`removeIndicator`/`removeScript`. Click selects the drawing on chart (`draw.sel`; highlight kept in sync from `redraw` via `syncObjTreeSel`), double-click renames inline (`otStartRename` → `s.name`, persisted with the shape). Toolbar row above the tree: new-group folder (`s.group` — grouped drawings render indented under a folder header), clone, visual-order menu (`otZOrderMenu` → `moveShapeZ`: front/forward/backward/back reorders `draw.shapes`), and clean-all. `persist()` pings `scheduleObjTreeRefresh()` (100ms debounce) so chart-side changes live-refresh the tree. The **Data window** tab (`renderDataWindow`/`updateDataWindow`) shows Date/Time/OHLC/Change plus the built-in RSI pane values and one row per indicator plot (names from `IND_META[type].plots`, values via `valueAtTime` — `rsiLine`/`rsiMa` get the same `setData` → `_data` capture as indicator series), following the crosshair through `updateCrosshair` and falling back to the latest bar.

**Named watchlists** — `WATCHLISTS = {name: groups[]}` with `ACTIVE_WL`; the legacy single `fv_watchlist` migrates in as "comeback". `saveGroups` writes both the legacy key and `fv_watchlists`/`fv_active_wl`. The `#wlNameBtn` header dropdown is a full TradingView-style list menu: Share list (`shareWatchlist`, clipboard stub), Add alert on the list (`alertOnList`), Make a copy (`copyWatchlist`, deep-clone), Rename (`renameWatchlist`), Add section (`addGroup`), Clear list (`clearWatchlist`), Create new list (`createWatchlist`), Upload list .txt (`#wlImportFile` → `importWatchlistText`), Open list / Shift+W (`openListBrowser` dialog), plus a RECENTLY USED section (from `RECENT_WL`, click to switch). Switching swaps `GROUPS` to the active list and rebuilds the view.

**Invert / percent scale** — the chart right-click menu offers Auto/Log/Percent (`setScaleMode` → priceScale `mode`) and Invert (`toggleInvertScale` → priceScale `invertScale`, flips the chart vertically).

**Right rail (full TV icon set)** — a far-right vertical icon rail (`#rightRail`), split by a flex `.rr-spacer` into a **top group** (Watchlist, Alerts, Object tree, Ideas&Chat) and a **bottom group** (Technicals, Screener, Economic calendar, News, Notifications, **Pine Editor**, Paper trading, Help). All 12 buttons are thin-line monochrome SVGs (`ICON.*`, `currentColor` `#b2b5be`, 20px) with `title` tooltips. The active panel's icon highlights blue (`.rr-active` → `#2962ff`) via `setRailActive(kind)` (exposed on `window` for the dock controller), which persists to `localStorage["fv_rail_active"]`; boot re-clicks the stored button so the last panel re-opens. (The old **Apps** stub — TradingView's marketplace grid, which needs their backend — was removed and its rail slot given to the Pine Editor; see §6.1.)

**Docked right-sidebar panel** — every rail icon opens its panel DOCKED in `#rightPanel` (a flex sibling of `#watchlist` inside `#app`), never floating: `openDock(kind, title, render)` hides the watchlist (`html.dock-open`), renders into `#rpBody` (with an optional `#rpHead` title + ×), and highlights the icon; `closeDock()` restores the watchlist; `railToggle(kind, openFn)` gives one-panel-at-a-time semantics — clicking another icon switches panels, clicking the active icon closes. The Watchlist icon simply closes the dock. **Alerts** docks by re-parenting the existing `#alertsPanel` element into the dock (`openAlertsDock`, `.docked` CSS overrides); `undockAlertsPanel()` returns it to `#app` on switch/close, so the floating `toggleAlertsPanel` path (topbar right-click, backdrop) still works.

Rail panels: `railPanelShell(title, html, kind)` renders into the docked `#rightPanel` (one panel open at a time; the floating `#stubPanel` is gone). **Technicals** (`openTechnicalsPanel`) computes real votes from `lastData` via `technicalsVotes()` — SMA/EMA 10/20/30/50/100/200 vs close plus RSI(14)/MACD(12,26,9)/Stoch %K/CCI(20)/Momentum(10)/Williams %R(14) with classic thresholds — and `technicalsVerdict()` maps net score to Strong Sell…Strong Buy, rendered as an SVG semicircle gauge + counts + per-check rows. **Notifications** (`openNotificationsPanel`) lists `ALERT_LOG`; unread = entries newer than `fv_notif_seen`, shown as a red `.rr-badge` count on the bell (`updateNotifBadge`, called from `logAlert` and at boot; opening the panel stamps `fv_notif_seen` = now and clears the badge). A **Clear all** button (shown only when the log is non-empty) calls `clearNotifications()` — empties `ALERT_LOG`, clears `fv_alert_log`, re-renders the panel to its empty state, and refreshes the badge. **Help** (`openHelpPanel`) shows the `KEY_SHORTCUTS` keyboard-shortcuts list plus an **AI assistant — MCP + API** section: live bridge status (Off / Waiting for bridge server / Connected, from `AGENT_ON` + `window._agentLinked` via `agentHelpStatus()`, refreshed every 2s by a self-clearing interval while the panel is open) and the quick-start steps + tool/endpoint summary for the LLM bridge (§14). **Pine Editor** (`openPineEditor`) opens a wide **docked panel** (`#pinePanel`, a flex sibling of `#main`) that shrinks the chart — not the narrow shared rail dock; see §6.1. Ideas/News/Screener/Calendar/Paper open `openStubPanel(kind)` — placeholder shells (no backend in this single-file build). **Resizable right sidebar**: `wireSidebarResize()` wires **two** grips to the same `--wl-w` CSS var (200px–50%, persisted `fv_wl_width`) — `#wlResize` on the watchlist and `#rpResize` on the docked panel. The dock needs its own grip because `#watchlist` (which owns `#wlResize`) is `display:none` while a dock panel is open; without it a docked panel would be stuck at the default 300px. Only one grip is ever visible, so they share one saved width. The topbar/grid use `right:0` inside `#main` so they follow the resize.

**Pattern tools / tool favorites** — `elliott` (6-click 0-1-2-3-4-5), `xabcd` (5-click X-A-B-C-D), and `headshoulders` (7-click LS/T1/H/T2/RS + 2 neckline points) are labeled multi-point tools rendered by `drawLabeledPath` (connected segments + a label bubble at each vertex); all three share the polyline-style multi-point hit-test and persistence. `TOOL_FAVS` (persisted `fv_tool_favs`) pins favorited drawing tools to a cluster at the top of the left rail; the flyout rows have a ☆/★ star (`toggleToolFav`).

**Toasts / settings gear** — `toast(msg, kind)` shows a bottom-center notification (`#toastWrap`, ok/err variants, auto-dismiss), wired to screenshot-save and drawing-template-save. The settings button (`#btnSettings`, an inline stroke-SVG gear icon — see §8) opens the chart-settings dialog.

**Drawing templates / pane controls** — a shape's context menu → "⭐ Save style as default" (`saveDrawTemplate`) copies its style into `DEFAULT_STYLE` and persists `fv_draw_default` (restored at boot), so new drawings inherit it. Sub-pane labels gained ▁ collapse (`togglePaneCollapse` → 22px strip) and ⤢ maximize (`togglePaneMaximize` → 70vh) buttons alongside gear/close. On each WebSocket tick `flashLastPrice(up)` briefly flashes the last-price/countdown pill green/red.

**Chart settings / templates** — the chart right-click menu → "⚙ Chart settings…" opens a dialog for candle up/down colors, background, gridline color + visibility (`CHART_SETTINGS`, `applyChartSettings`, persisted `fv_chart_settings`, restored at boot). **Indicator templates**: the indicators dialog has a Templates dropdown — `saveIndTemplate`/`loadIndTemplate` store/restore a named set of indicators in `fv_ind_templates`. **Alert on drawing**: `alertSourcesWithDrawings()` adds line drawings (hline/hray/trend/ray/ext) to the alert source/target lists; `sourceValue("draw:<id>")` resolves the drawing's level (trend/ray extrapolated to the last bar).

**Alert enhancements** — trigger frequency now includes `perbar` (once per forming bar, guarded by `a._lastBar`) alongside `once`/`every`. `fireAlert` records to `ALERT_LOG` (persisted `fv_alert_log`, last 100), shown in the alerts panel's HISTORY section. Each alert row has a ⏸/▶ pause toggle. `ALERT_SOURCES`/`sourceValue` expose 15 operands: price, the six MAs, RSI, MACD line/signal, ATR, CCI, VWAP, Williams %R, Volume — all computed live from `lastData`.

**Strategy tester** — Freeview Script exposes a `strategy` API: `strategy.entry(cond[])` / `strategy.exit(cond[])` mark per-bar long entry/exit signals (also plotted as ▲/▼ markers). `runScript` carries the signals out on `plots._signals`; `runBacktest(data, signals)` simulates a long-only strategy (enter at the *next* bar's open when entry fired & flat, exit at next open when exit fired & long — no look-ahead), returning `{trades, netPct, winRate, numTrades, equity}`. `renderStrategyResults` shows a `#strategyPanel` (Net %, win rate, #trades + recent-trades list). Also added script plot helpers `plotshape`/`hline`/`fill` and confirmed the `ta.*` built-ins (sma/ema/wma/rma/stdev/highest/lowest/rsi/atr/change/roc/crossover/crossunder).

**Multi-chart grid** — a low-risk iframe approach (chosen over refactoring ~170 single-chart references). The **layout picker** (`#layoutMenu.layout-pick`, TV parity) is driven by the `LAYOUTS` registry — 25 variants grouped by chart count 1–16 via `LAYOUT_GROUPS` (counts 1,2,3,4,5,6,7,8,9,10,12,14,16). Each variant is `{n, cols, rows, areas?}`; `areas` (grid-template-areas rows, panel i = area `p{i}`) expresses mixed/asymmetric splits (e.g. `3l` = 1 big left + 2 right, `7t` = 3 top + 4 bottom). `layoutThumb(key)` renders each variant as a mini-grid thumbnail in the picker; the toolbar button (`#layoutSelLabel`, rebuilt by `syncLayoutUI`) shows a live mini-thumbnail of the ACTIVE layout + chart count + ▾ chevron, with a blue **Save** button (`#btnLayoutSave` → `saveNamedLayout`) beside it. Selecting a variant calls `buildGrid(layout)`, which sets the grid template inline from the registry (so no per-layout CSS is needed; legacy keys `2h/2v/4` still resolve for persisted `fv_layout` values) and fills `#chartGrid` with N `<iframe src="index.html?embed=1&sym=X&tf=Y">` — each a full independent Freeview instance. `IS_EMBED` (from `?embed=1`) hides the panel's watchlist and disables active-state persistence so panels don't clobber each other. `fv_layout` auto-persists the layout + per-panel symbols; named layouts live in `fv_layouts_named`.

**SYNC IN LAYOUT** — the picker's bottom section renders 5 toggle switches (`GRID_SYNC_DEFS`: Symbol / Interval / Crosshair / Time / Date range, each with an ⓘ tooltip) backed by `_gridSync` (persisted `fv_grid_sync`; crosshair defaults ON and maps onto `_gridSyncCrosshair`). Toggling doesn't close the menu. Live application is all `postMessage`: embed panels emit `{fvx:"crosshair", time}` via `relayXhairToGrid(time)`, `{fvx:"panechange", sym, tf}` from `loadChart`, and `{fvx:"range", from, to}` from `subscribeVisibleTimeRangeChange` — the latter two guarded by `_syncFromParent` so changes applied FROM the host never echo back.

**Crosshair echo fix (`relayXhairToGrid`).** The shared vertical dashed line used to bounce and land at mismatched positions across panels. Root cause: the relay lived in `chart.subscribeCrosshairMove`, but the overlay canvas (`#draw`) eats the real mousemove and drives the crosshair **programmatically** via `updateCrosshair → chart.setCrosshairPosition`, so that callback fires **identically** for a genuine local hover and for a host-driven set — it couldn't tell them apart, so panel B's host-set crosshair re-emitted, looping A→host→B→host→A (the bounce). A value-compare guard couldn't fix it because LWC **snaps** a programmatic set to the nearest bar, so the echoed time differs from the sent time (also the source of the position mismatch). Fix: relay ONLY from the genuine local-hover paths — `relayXhairToGrid(time)` is called inside `updateCrosshair` (real overlay mousemove) and the `dcanvas` `mouseleave` (relays `null` to clear the others' vertical). A panel that merely **received** a crosshair from the host runs `setCrosshairPosition` but never `relayXhairToGrid`, so it stays silent and the loop can't form. Since all panels share the same TF/timeline, the follower snaps to the same bar → positions match. Verified: `test/regression_grid_crosshair.mjs` (relays 8 post-fix vs ~99–225 pre-fix). The host's message hub relays per the toggles: crosshair → relay as-is; `panechange` → update `_gridPanels[i]` + `persistLayout()`, then `setsym`/`settf` to siblings when Symbol/Interval sync is on; `range` → `setrange` to siblings when Time OR Date-range sync is on (decision: both toggles mirror the source panel's visible time range via `setVisibleRange` — the safest common mechanism; TV's subtle distinction between them isn't reproducible without per-panel bar alignment). Embeds handle `setsym`/`settf` (reload chart), `setrange` (`timeScale().setVisibleRange`) and `setinds` (replace the panel's indicator set — used by named-layout restore). Embeds do NOT emit `panechange` for their boot load (`window._fvBootLoadDone` guard) — otherwise with symbol/interval sync ON the last panel to boot would homogenize every sibling.

**Dividers, maximize, named layouts** — `buildGridDividers()` overlays `.grid-div` strips at internal track boundaries; dragging shifts fr-weight between the adjacent tracks (`_gridSizes {cols,rows}`, min 15% per track, iframes `pointer-events:none` during the drag) and persists with `fv_layout`. Each panel gets a hover `⛶` (`.grid-max`); `toggleGridMax(i)` makes that iframe fill the grid (`.maxed`/`.gmax`, siblings hidden, dividers off) and back — session-only. `saveNamedLayout` stores `{layout, panels[{sym,tf,inds}], sizes, sync}` — indicator sets are snapshotted from the shared per-symbol `fv_indicators_<sym>` localStorage (cross-frame `contentWindow` variable reads don't work; same-symbol panels share one set); `loadNamedLayout` restores sync toggles + sizes + grid and pushes `setinds` into each panel after it boots.

**Selected panel** — embeds emit `{fvx:"focus"}` on any `pointerdown`; the host's `selectGridPanel(i)` marks that iframe `.gsel` (accent border; panel 0 selected when a grid builds). Host toolbar actions target the selection: a watchlist symbol click goes through `gridTargetSym(sym)` and the timeframe menu through `gridTargetTf(tf)` — both postMessage `setsym`/`settf` to the selected panel only (or ALL panels when the corresponding SYNC toggle is on), update `_gridPanels` and `persistLayout()`. Indicator management stays per-panel via each embed's own toolbar (each iframe is a full app instance) — routing indicator adds cross-frame would require serializing indicator state and was deliberately not done.

**Mobile alert bridge** (`IS_EMBED`) — the ENGINE owns all alerts; the mobile app mirrors and remote-controls them. Inbound: `{fvx:"setalerts", symbol, alerts:[…]}` — active symbol → replace in-memory + `saveAlerts()` + redraw + **`checkAlerts()` immediately** (already-true gt/lt fire instantly); other symbols → write `fv_alerts_<sym>` localStorage directly (picked up on next load). `{fvx:"alertdialog", existing?}` → `openAlertDialog()` (create or pre-filled edit). Outbound `emitAlertsChanged()` (from `saveAlerts()`, i.e. any create/edit/drag/delete/toggle) posts `{fvx:"alertsChanged", symbol, alerts:[full records: id,source,op,target,value,trigger,expiry,message,notify,sound,active]}` over both `parent.postMessage` and `window.ReactNativeWebView.postMessage`. `_alertsFromHost` guards the echo. **Embed extras:** the toolbar is stripped to tf + chart-type (`html.embed #topbar #ctSel ~ *{display:none}` hides Compare/Indicators/Alert/Script/Snap/Layout/Replay/Undo/status — the app overlays its ƒ/✎/ⓘ icons in that space); `#symbolBox` (search + `SYM · venue · tf`) is display:none in embed (legend shows the symbol; search is host-side). **Touch bridge** — the draw canvas replaced the chart's built-in gestures with mouse-only handlers, which left phones dead; dcanvas touchstart/move/end now re-dispatch synthetic mouse events (1 finger = pan/draw/drag/select through the desktop code paths) and 2 fingers pinch-zoom the time scale anchored at the pinch midpoint (`_pinch`), with `touch-action:none` on `#draw`. The RSI pane has the same bridge scoped to its price-axis gutter (rsiEl touchstart → synthetic mousedown → existing rsiAxisDrag stretch; alert-line touch drags still win in the plot area).  `fireAlert()` additionally posts `{fvx:"alertFired", symbol, message, sound:{kind,id}, notify}` over the same dual bridge when an alert triggers — the mobile app turns it into a phone/browser notification (regression: `test/regression_alert_fired_emit.mjs`). Only `source:"price"`+`target:"value"` alerts draw a horizontal line (`drawAlertLines`). Dialogs never exceed the viewport (`.dialog{max-width:calc(100vw - 12px)}`) and the alert dialog's `.twocol` rows wrap (`flex:1 1 140px`) — fixed widths (440px alertdlg) used to overflow phone-width WebViews and clip the label column (regression: `test/regression_alert_dialog_mobile_fit.mjs`, viewport 360×780).

**Alert trigger latency** — `applyTick()` (per WS trade tick) evaluates `checkAlerts()` FIRST, immediately after the last-bar price mutation and BEFORE the heavy `applyChartType` repaint, so tick→alert is effectively instant. The dialog's Create/Save also runs `checkAlerts()` right away. WS resilience: `visibilitychange`(visible) + `online` reconnect immediately (`_wsRetry=0`), skipping the exponential backoff. Non-Coinbase legs still rely on the 20s poll (no WS wired).

**Light theme** — the 🌙/☀ toolbar button toggles `<html class="light">`, which flips the CSS custom properties to a TradingView light palette (`--bg:#fff`, `--text:#131722`, green `#089981`, red `#f23645`, etc.). `applyTheme(light)` also re-applies matching `layout`/`grid`/`border` colors to every LWC chart (main, RSI, indicator + script sub-panes, compares) and persists to `localStorage["fv_theme"]` (default dark, restored at boot).

**Real-time WebSocket** — `wsConnect()` opens Coinbase's public `wss://ws-feed.exchange.coinbase.com` and subscribes to the `ticker` channel for the active symbol's Coinbase leg(s) (`wsProductsForActive`). Each tick updates `_wsLast[product]`; `applyTick()` recomputes the live price (ratio = legA/legB), writes it into the forming bar's close/high/low, and re-routes the update through `applyChartType(lastData)` (a full `setData` with the future tail) rather than `candle.update()`. This is deliberate: the candle series' last point is the ~4-month **future whitespace** tail, so `candle.update({time: lastBar})` targets an interior time and throws `Cannot update oldest data` in Lightweight Charts — and that failed update **truncates the whitespace tail**, leaving the time scale scrolled into a now-empty future region and blanking the visible candles. `applyChartType` re-supplies the tail every tick, so the view stays intact. `ws.onclose` reconnects with exponential backoff (1s→64s cap). A 1s poll of `activeSymbol` re-subscribes on symbol change. The 20s `loadChart` poll stays as source-of-truth / reconnect safety net and covers Binance/Bybit/Yahoo legs the WS doesn't handle. `applyTick()` also calls `checkAlerts()` after each tick so alerts crossed between polls (via the WS feed) still fire. Because Coinbase's candle endpoint lags real time, the 20s poll's snapshot can report the forming bar's high/low *below* the intrabar wick the WS already captured; `renderData(data, keepView)` therefore merges the previous forming bar into the incoming last bar (max-high / min-low, WS close) when the bar times match, so the live wick survives the refresh instead of vanishing.

**Compare overlay** — the ＋Compare button prompts for a symbol; `addCompare(sym)` fetches it (`fetchKlines`) and plots a **% -normalized** line (change from its first bar) on its own hidden price scale (`priceScaleId:"compareN"`), so assets at very different price levels overlay comparably. `COMPARE` holds `{sym:{series,color}}`; chips render in the floating legend (`#compareLegend`) with an × to remove; `reloadAllCompares` refetches them when the base chart reloads (TF change). `loadCompareData` re-reads `COMPARE[sym]` after its `await` and bails if the series was removed or replaced mid-fetch (`COMPARE[sym]!==c`), so a compare removed/re-added while its fetch is in flight can't write to a disposed or stale Lightweight Charts series.

**Indicator hover values** — `recordData(series)` wraps a series' `setData` to stash the last array on `series._data` (LWC has no getData). `updateIndLegendValues(time)` (called from `updateCrosshair`) looks up each indicator's value at the crosshair time via `valueAtTime` and writes it into the legend row's `.vals` slot (overlays) or a `.subVals` span in the sub-pane label (oscillators); cleared on mouseleave (legend reverts to the latest bar).

**Watchlist column sort** — the `#wlCols` header cells (Symbol/Last/Chg/Chg%) are clickable → `sortWatchlist(key)` cycles asc → desc → off. Non-destructive: `GROUPS` order is never mutated; `buildWatchlist` renders each group via `sortedSymbols(g.symbols)` which returns a sorted copy keyed off `PRICE_CACHE` (updated by `refreshPrices`) when `wlSort` is set. Rows are 32px with a thin bottom divider between assets (`box-shadow:inset 0 -1px 0 0 var(--border)` — a shadow, not a border, so the 1px line never shifts the flex baseline; overridden by the drag drop-indicator shadow while reordering); 20px coin icons; price cells flash via `flash-up`/`flash-down` keyframes on change.

**Watchlist flags** — `SYMBOL_FLAGS` maps symbol → hex color, persisted in `localStorage["fv_flags"]`. A right-click row menu (`showRowMenu`) offers **Open**, **View details**, and 6 `FLAG_COLORS`; the chosen color renders as a ⬤ dot at the left of the row.

**Pair info card** — `showRowMenu`'s "View details" opens `openPairInfoCard(sym)`, a floating card (Esc or × close it, `closePairCard(card)`). It has **no backdrop** — it floats over the chart without dimming it, so you can still see/interact with the chart behind — and is **draggable by its header** (`pcDragWire(card)`: on first drag it swaps the centered `translate(-50%,-50%)` for pixel `left/top` and follows the cursor, clamped to the viewport; drags starting on the ×, arrows, or dots are ignored). It shows the pair (logo, exchange, spot/perp/spread type), a large last price + 24h change, then data-filled sections: **Market·24h** (24h high/low, base + quote volume, range position, prev-close/open) from `fetchRichStats(leg)` — a per-venue ticker call (Coinbase `/stats`; Binance `/ticker/24hr?symbol=`; Bybit `/tickers?symbol=`; Yahoo chart meta, each surfacing venue-specific extras like Binance weighted-avg/trade-count, Bybit funding/open-interest, Yahoo 52-wk range) — **Technicals·Daily** (RSI 14 with a gradient meter, SMA 20/50 + trend, ATR 14, 1Y high/low) computed from a daily candle fetch (`fetchCardCandles`, which `makeRatio`s both legs for a spread), and a **Pair** section (symbol/type/exchange or numerator/denominator). Footer has **Open chart** + **Add alert**. Every field degrades to "—" when a source is unavailable; a per-card `card._seq` guard drops stale async fills. Distinct from the topbar's lighter `showSymbolInfo` popover.

**Multi-card stacking (web only)** — up to `PC_MAX = 2` cards can be open at once so two symbols can be compared side by side. Cards are cloned `.pair-card` nodes appended to the `#pairCards` container (there is no longer a single `#pairCard` element); the open set lives in `_pcOpen[]` (oldest first). Opening a 3rd card closes the oldest; re-opening an already-open symbol focuses it instead of duplicating. `pcFocus(card)` keeps exactly one `.front` (z-index 403); the 2nd card gets `.stack1` (a 28px margin offset) so it isn't buried under the 1st, and the offset is dropped once only one card remains or the card is dragged (drag pins explicit `left/top` + `margin:0`). Esc closes the front-most card only. **In embed mode (`IS_EMBED`, i.e. the mobile WebView and grid panes) the limit is 1** — the original single-card behaviour is unchanged, and no phone/viewport detection is involved. All per-card state hangs off the element (`card._sym`, `card._seq`, `card._rsiSym`, `card._smaSym`, `card._page`) rather than module globals, so a 2nd card never cancels the 1st card's in-flight fetches; child elements are addressed by scoped `[data-pc="…"]` attributes rather than `id`s (which would collide across cards).

**Asset blurbs** — `ASSET_INFO` (~174 entries) maps a base ticker (`legBase(sym)`) → `{d: description, w: website}`, rendered under the price on page 0. **Static and network-free by design**; unknown assets simply render no blurb — never fabricated. Covers ~94% of Binance 24h USDT volume plus major ETFs/equities/futures (Yahoo legs resolve to bare tickers, e.g. `GC=F` → `GC`). Notable ticker cases: `POL` (which replaced `MATIC` in Polygon's 2024 migration) and `GRAM` (which replaced `TON` in the 2026 rebrand) are both present, with the superseded tickers kept for historical charts; `MUB` is a Binance **bStocks** tokenized equity (ticker = underlying + `B`). Assets are deliberately omitted where the ticker is ambiguous or has no verifiable source (e.g. `U`, `EPIC`). Extending coverage past the long tail would need a live metadata API (e.g. CoinGecko) rather than more static entries.

The card is 560px wide with a **3-column** stat grid (wider + shorter than the old 2-col), a gradient header with a type badge, a colored change chip, and section headers with trailing rules. **Every stat cell carries a hover help box** — `pcCell` looks the label up in `PC_HELP` (plain-language definitions) and emits `data-help`; a CSS `::before` renders the box on hover (a `?` hint appears in the cell key), with rightmost-column cells (`nth-child(3n)`) anchoring the box to their right edge so it stays on-card. Each section is built with `pcGrid(cells)`, which pads a partially-filled final row with blank `.pc-fill` cells (panel-colored, non-interactive) so a 2-of-3 row never leaves a dark gap. **`pcCell(k,v)` HTML-escapes the value itself** (via `escHtml(String(v))`) — the single choke-point that keeps raw API strings (e.g. Yahoo's `currency`) and symbol text out of `innerHTML`; numeric values additionally pass through `fmtPrice`, which returns `"—"` for `null`/`NaN`/`±Infinity` so a missing exchange field never renders as literal `NaN`.

The card is a **3-page carousel** (`.pc-track` slides via the card's own `.pg1`/`.pg2` class, `PC_PAGES=3`; two header arrows ‹ › sit side-by-side left of the × and step pages, footer dots jump, `wirePairCardNav(card, sym, isSpread)` tracks `card._page`; both arrows are always rendered and get `.disabled` — dimmed + non-clickable — at the ends: ‹ on page 0, › on the last page). **Page 0** is the details above. **Page 1** is a **multi-timeframe RSI** table (`loadRsiPage`, lazy on first nav): one row per timeframe in `PC_RSI_TFS` (1m,5m,15m,30m,1h,2h,4h,6h,12h,1d,1w,1M), each showing RSI(14)-close (green oversold / red overbought / white neutral) on a gradient meter with a dot. **Page 2** is a **multi-timeframe SMA** matrix (`loadSmaPage`, lazy): a TF×period table (rows = the 12 TFs, columns = `PC_SMA_PERIODS` 7/25/99/150/200/300) with a sticky TF column, each cell the last SMA value colored green when the last close is above it, red when below ("—" when history is shorter than the period). Both pages fetch candles per TF via `fetchTfBars(sym, tf, isSpread)` (single leg or `makeRatio` spread) and fill rows/cells as they land, guarded by `card._seq` (card changed/closed) and `card._rsiSym`/`card._smaSym` (avoid refetch). RSI also uses `fetchSpreadRsi`/`rsiFromBars`.

Drawings are keyed per **symbol + timeframe** so a BTC-USD 1D layout does not clobber BTC-USD 1H. Scripts, alerts, and indicators are keyed per **symbol only**. Active symbol/TF, timezone, and indicator favorites are global. So a reload restores the full workspace: symbol, timeframe (incl. custom), drawings, indicators (with params + hidden state), alerts, scripts, and timezone.

---

## 10. Watchlist

The watchlist panel (`#watchlist`, default 300px, resizable via `#wlResize` — see §8, persisted `fv_wl_width`; background `--bg` with a `--border` left divider) renders `GROUPS[]` as collapsible sections with draggable rows. `DEFAULT_GROUPS` seeds two sections (ALPHA, SECTION 2). A one-time migration (`migrateComebackDefault`, guarded by `localStorage["fv_wl_reset_v3"]`) resets the "comeback" list to that default once per browser, then never again — so a user's later customisations survive reloads. Section headers show a `−` glyph when expanded and `+` when collapsed (`.caret`; click toggles collapse). **Whole sections are draggable to reorder**: each header is `draggable` and wired by `groupDragWire` (`wlGroupDrag` state, `.gdrop-above`/`.gdrop-below` indicators) → `moveGroup(fromName,toName,before)` splices the group within `GROUPS`; a completed drag sets `_groupDragged` to swallow the trailing collapse-click. This is distinct from row (symbol) drag (`wlDragWire`/`moveSymbol`) and from dropping a symbol onto a header (`sectionDropWire`); all three drop paths guard on their own drag state so they never collide.

### Groups and rows

`buildWatchlist()` clears `#wlBody` and iterates `GROUPS`. Each group gets a `.section` header with collapse toggle and a trash icon (visible on hover). Each symbol gets a `.row` with a logo (`iconHtml(base, cls, leg)` — see **§chart-icons** below), exchange badge, last price, absolute change, and percent change columns plus a per-row trash icon and an eye (view) toggle beside it. The eye (`.eye`, `icEyeWl(sym)` — slashed when hidden) masks **that one symbol's** price cells (Last/Chg/Chg%) as `••••••` via `toggleWlPrice(sym)`; the masked legs live in the `WL_HIDDEN` set (persisted in `localStorage["fv_wl_hidden"]`), the row carries `.masked` (dimmed muted cells), and `refreshPrices` early-returns for a hidden symbol so live ticks don't overwrite the mask (`PRICE_CACHE` still updates so sorting works). Toggling off calls `refreshPrices()` to repaint real values. Masking is per-asset, never list-wide.

**§chart-icons — one icon renderer, `iconHtml(base, cls, leg)`.** Every icon in the engine (watchlist rows, Add-symbol search rows, spread chips, pair-info `pc-ic`) goes through `iconHtml`, which builds an ordered `logoChain(base, leg)` and renders an `<img>` whose `onerror` walks the chain rung-by-rung, degrading to a `#2962ff` letter circle only when every source 404s. Each rung rebinds `onerror` before swapping `src`, so a second failure advances instead of re-firing forever. The class is picked from `leg` (a bare base can't tell a stock from a coin of the same ticker):

- **Crypto** — CMC's id-keyed logo CDN first (ids from `/api/market/coinlogos`, broadest coverage incl. new listings), then CoinCap's ticker-keyed CDN, then the stripped-ticker on CoinCap. `cmcIdFor` resolves the id by (1) exact ticker — always first, so `1INCH` (a real coin, id 8104) beats the strip in step 3; (2) inner ticker of a `NAME(TICKER)` display name — `GOLD(PAXG)`→PAXG, since the outer word ("GOLD") collides with an unrelated coin; (3) `stripMultiplier` for perp bundles — `1000BONK`→BONK, `10000SATS`→SATS (pattern is `1` + only zeros, so `1SOL`/`11BIT` are untouched).
- **Stocks / ETFs** (`YF:` non-`=X`/`^`/`=F`) — parqet's keyless logo CDN (`assets.parqet.com/logos/symbol/<t>?format=png`); opaque square tiles, 404 clean on unknown ticker.
- **FX** (`YF:XXXYYY=X`) — a **split circle of both currencies' flags** (base top-left, quote bottom-right, same `.split`/`.half` geometry as spreads) so `USDMXN` and `MXNUSD` read differently at a glance. Flags from `flagcdn.com` (ISO-4217 first two letters = ISO-3166 country for nearly all; EUR→eu served); each half falls back to the 3-letter code on a 404. `fxPair()` returns the two codes, excluding metals (XAU/XAG — not countries), which stay on the single-icon path. Indices (`^`) and futures (`=F`) have no logo source → letter circle.

**Two dark-art escapes** (a black glyph on transparent serves HTTP 200, so `onerror` can't catch it — the ticker must be named): `CMC_BAD_LOGO` (`1INCH`, `WLD`) skips the CMC rung entirely because CoinCap has brighter full-colour art; `DARK_LOGO` (`UPC`, `LAB`, `ONDO`, `SEDA`, `BP`, `TRUTH`, `IO`) keeps the CMC logo but adds `.on-light` (a `#f5f6fa` disc) so the glyph reads, mirroring how CMC's own dark theme renders them — `.on-light` is dropped by the `onerror` handler if the chain falls past the CMC rung. Both sets are measured (mean luminance of visible pixels < 20 across MEXC's top 200; `SOL`/`DOT` at 20–45 stay as-is). Spreads (`A/B`) get a diagonally-split circle via `splitIconHtml` — leg A top-left, leg B bottom-right (`clip-path` polygons, thin seam), each half its own `iconHtml` chain. `normSym`'s allowlist + `encodeURIComponent` on the base keep hostile input out of the `<img src>` and the inline `onerror`.

Row click: sets `activeSymbol`, calls `loadPersisted` / `loadAlerts` / `loadScripts`, then `loadChart`.

### Drag-to-reorder

HTML5 drag-and-drop via `wlDragWire(row)`. Dragging a row over another shows a blue insertion indicator (`.drop-above` / `.drop-below`). `moveSymbol(fromGroup, fromSym, toGroup, toSym, before)` splices the symbol in `GROUPS` and calls `saveGroups` + `buildWatchlist`. Dropping onto a collapsed section header (`.section`) appends to that group via `sectionDropWire`.

### Add-symbol dialog — `openAddSymbolDlg`

Opens `#symDlg` with a search input and tabs **All / Crypto / Stocks & more / FIAT / Spread** (classic underline style). Selecting **Crypto** reveals a second tab row with the 8 exchanges (hidden by default; "Crypto" alone = every venue, a sub-tab narrows to one). **FIAT** = currency pairs only: the curated `=X` matrix (~120 — every liquid currency vs USD in BOTH directions, e.g. `MXNUSD=X` and `USDMXN=X`, plus the full G10 cross matrix and XAU/XAG spot) ∪ live Yahoo forex hits. **Search-by-name**: `fetchCryptoNames()` (CoinGecko `coins/list` + Coinbase `/currencies` overlay + `STABLE_NAMES`/`CCY_NAMES`/canonical overrides — ETH→"Ethereum", Kraken's XBT→"Bitcoin") composes every crypto row's `name` as "Bitcoin / TetherUS", and FIAT rows use `CCY_NAMES` ("Mexican Peso / US Dollar") — so typing "bitcoin" or "peso" finds the pairs. `symMatches` ranks exact base-name (`nm.startsWith(q+" /")`, 65) above name-prefix (45) above substring (40). `loadProducts()` fetches the full live catalog from **all eight crypto venues** in parallel via `Promise.allSettled` (a venue that fails is silently skipped), plus two non-crypto sources: `/api/market/symbols` (~12.6k US stocks + ETFs from NASDAQ Trader's official directories, cached server-side 24h) and `curatedNonCrypto()` (~95 FX pairs, world indices, liquid futures as `YF:` legs). Results are cached in `PRODUCTS` — **~24.5k symbols, loads in ~3s**. Every searchable symbol is chartable: the Big-5 venues each have a kline adapter (`fetchPageKraken`/`Okx`/`Kucoin`/`Gate`/`Mexc`) and a bulk-ticker fetcher for watchlist prices; non-crypto rides the existing Yahoo branch. CORS-blocked venues (KuCoin/Gate/MEXC) route through `/api/market/proxy` — the app's own allow-listed same-origin proxy — via `fetchJSONDirectOrProxy` (direct → own proxy → public chain). Kraken serves only its newest ~720 bars (no backward cursor — single-shot like Yahoo).

The "Stocks & more" tab shows every prefetched `YF:` row plus live matches from Yahoo Finance's search endpoint (`/v1/finance/search`, quotesCount 50) via `fetchTVResults(q)` then `fetchJSONDirectOrProxy`. Results are cached in `tvCache` per query and deduped against the prefetched rows by leg. `scheduleTVSearch(q)` debounces remote calls by 220 ms and guards against stale async responses with a sequence counter (`tvSeq`).

`symMatches(q)` scores and ranks results: exact ID match = 100, exact base = 90, prefix = 80, name substring = 40. Yahoo results receive a baseline of 50 so relevant remote matches surface above loose crypto ones.

**Symbol sanitization (`normSym`).** The free-text fallback (Enter with no result rows) accepts a typed string, but `normSym` runs it through an **allowlist** (`[^A-Z0-9:.=^\-]` stripped) before it becomes a stored leg — real tickers only use A–Z 0–9 and the Coinbase `-` / venue `:` / Yahoo `.`/`=`/`^` separators. This keeps hostile input (e.g. `<img onerror=…>`) out of the symbol, which is later interpolated into a logo `<img src>`; `logoForBase` additionally `encodeURIComponent`s the base as defense-in-depth for any pre-existing persisted symbol.

**Spread tab — `renderSpreadBuilder`.** Selecting the **Spread** tab swaps the flat result list for a two-slot composer (`symDlgState.spread = {a, b, slot}`) that builds an `A/B` ratio leg (the app's original raison d'être — chart `NEAR-USD/INJ-USD` and any other pair). Two chips (Numerator A `/` Denominator B) sit above the same live search list; `symMatches` searches **every venue** for the Spread tab (both legs can come from anywhere — Coinbase, Binance, Bybit, or a Yahoo stock/FX/metal). Clicking a row (`chooseSpreadLeg`) fills the active slot and auto-advances A→B; the ✕ on a chip clears it. When both slots are filled, "Add spread" pushes `"<legA>/<legB>"` into the section via `pushSymbol` (which the existing `makeRatio` pipeline renders unchanged) and closes the dialog. Verified: `test/audit_spread_builder.mjs`.

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
- **No server-side alerts (web).** Web alerts only fire while the browser tab is open. Email notification is wired in the UI but silently no-ops. (The *mobile* app adds closed-app push via a Supabase Edge Function — see §13.)
- **No backtesting / strategy tester.** Freeview Script can compute indicators but has no order simulation.
- **No replay mode.** Bar replay requires replaying the data pipeline; deferred to a future wave.
- **No multi-chart layouts.** Single chart only.
- **No licensed global data.** Stocks, ETFs, and forex are served via Yahoo Finance's public (unauthenticated) endpoint; real-time quotes for non-crypto assets are subject to Yahoo's data agreements and may be delayed.
- **Freeview Script sandbox is not a true security boundary.** It is the user's own code on their own machine; `.constructor.constructor` can escape the parameter shadow. The shadow is a usability guard-rail only.

## 13. Mobile App — OpenView (`/openviewapp`)

Companion **Expo / React Native** app (Expo Router, RN 0.74, TypeScript). **Offline-first**: it runs fully without a backend; Supabase-dependent features (cross-device sync, anonymous auth, closed-app push) light up only when `.env` credentials are present. The chart itself is **not re-implemented natively** — it reuses the entire web engine through a WebView.

### Config & offline-first gating — `src/config.ts`
Resolves each value from `process.env.EXPO_PUBLIC_*` (read as **static** member expressions so Expo inlines them at build) → `app.json` `extra` → default. Placeholder/unset values (`YOUR_*`, `*PLACEHOLDER*`) are treated as empty. `supabaseConfigured` (both URL + anon key present) gates every network sync path — when false, all sync/auth/push functions no-op and local storage is the source of truth.

### Route map (Expo Router, `app/`)
| Route | File | Purpose |
| --- | --- | --- |
| `_layout` | `app/_layout.tsx` | Providers (SafeArea, `AppStateProvider`) + `NotificationRouter` (tap → Chart tab at the alert's symbol; cold-start + warm listeners) |
| `index` | `app/index.tsx` | Redirect → `/(tabs)/chart` |
| `(tabs)/_layout` | `app/(tabs)/_layout.tsx` | Bottom tab bar: **Watchlist / Chart / Alerts / Menu**, TV colors |
| `(tabs)/watchlist` | live prices (Coinbase 24h stats, 10s poll), tick flash, headers, long-press remove, ＋→search |
| `(tabs)/chart` | `ChartWebView` + header (symbol→search, interval→switcher, ƒ→indicators) |
| `(tabs)/alerts` | CRUD alerts, pause toggle, editor sheet; starts the in-app price watcher |
| `(tabs)/menu` | sync/config status, device id, versions |
| `search` (modal) | symbol search over all Coinbase products; tap→chart, ＋→watchlist |
| `indicators` (modal) | searchable indicator catalog; add/remove/configure period |

### Shared state — `src/state/AppState.tsx`
Context holding `symbol / timeframe / chartType / indicators` (+ mutators). Hydrated from AsyncStorage (`ov_app_state`), persisted on change, and opens the anonymous session at boot. All tabs read/write the same view so switching a symbol in one place updates the WebView everywhere.

### Chart bridge — `src/components/ChartWebView.tsx`
Loads the **deployed** Freeview `index.html?embed=1&sym=<symbol>&tf=<tf>` (the params the web engine already honors; a full reload only on symbol/tf change). Chart-type, indicators, and drawings are pushed **live** via `injectJavaScript` → a synthetic `MessageEvent` (`setChartType` / `setIndicators` / `setDrawings`), and the engine posts `drawingsChanged` back → persisted per-symbol. Touch: `scrollEnabled:false`, `bounces:false` so the WebView owns pinch-zoom / drag-pan / long-press crosshair.

### Data layer — `src/lib/coinbase.ts`
Same public source as the web app (`https://api.exchange.coinbase.com`, no key). `fetchProducts` (cached) for symbol search; `fetchTicker`/`fetchTickers` (`/stats`) → last price + 24h % change for watchlist + alert watcher.

### Persistence & sync — `src/lib/store.ts` + domain stores
Local-first key/value over AsyncStorage; when `supabaseConfigured`, mirrors each blob to a `sync_state` row keyed `(user_id, key)`, **last-write-wins** on `updated_at`, with a realtime `postgres_changes` subscription (`subscribeSync`). Domain stores: `watchlistStore` (`fv_watchlist_mobile`), `drawingsStore` (`fv_drawings_<symbol>`), `alertsStore` (`fv_alerts_mobile`). App-state key `ov_app_state`; device id `ov_device_id`.

### Auth — `src/lib/auth.ts`
`getDeviceId()` = per-install UUID (expo-crypto) in AsyncStorage — the sync namespace. `ensureSession()` = Supabase `signInAnonymously()` (so RLS scopes rows to `auth.uid()`); no-op + null offline.

### Alerts, notifications, push
- **In-app watcher** `src/lib/priceWatcher.ts`: 15s poll of alerted symbols, `above/below/cross` eval (`alertTriggered`), fires a local notification (banner + sound + badge) and auto-pauses the alert.
- **Notifications** `src/lib/notifications.ts`: foreground handler (sound+badge), permission request + Android channel, `fireLocalAlert`, `setBadgeCount`, `registerPushToken` (stores the Expo token in `push_tokens`).
- **Closed-app push** `supabase/functions/alert-watcher/index.ts`: a cron-scheduled Edge Function that scans active alerts → current Coinbase price → Expo Push to that user's tokens → marks the alert triggered.

### Supabase schema — `openviewapp/supabase/schema.sql`
The mobile app owns `sync_state`, `push_tokens` and `push_alerts` — **in the same Supabase project the
web app uses**. Requires **Anonymous sign-ins ON** (Auth → Providers). Setup + Edge Function
deploy/cron steps are in `openviewapp/README.md`.

> **→ See §18 for the authoritative, live-verified account of the shared Supabase project.** Do not
> duplicate table/RLS details here — a second copy is how this drifted before (this table used to
> list an `alerts` table that does not exist; the real one is `push_alerts`).

### MCP
`openvieweb/.mcp.json` is **gitignored and per-developer**, hardcoding the project ref + access token.
`openviewapp` has its own. See §18.4 — the env-var indirection this used to rely on silently
resolved to the wrong project.

### Theme — `src/theme.ts`
Exact TradingView palette mirrored from the web CSS vars: bg `#131722`, panel `#1E222D`, border `#2A2E39`, accent `#2962FF`, up `#26A69A`, down `#EF5350`; `userInterfaceStyle: dark`.

## 14. LLM Bridge — API + MCP (`mcp/`)

Lets an LLM (Claude via MCP, or anything speaking HTTP) connect to a **running** chart, read its data, and add/remove its own drawings ("where is the resistance? → draws the lines"). Surface is deliberately chart-only: **no** code/settings mutation, alerts+indicators are **read-only**, and the LLM can only delete drawings it created. See `mcp/README.md` for setup.

### Server — `mcp/server.mjs` (zero dependencies, Node ≥18)

One file, three roles, bound to **127.0.0.1** (default port 8787, `OPENVIEW_PORT`):

1. **Page bridge** — the app long-polls `POST /bridge/poll` (each request carries the previous batch's results and is held ≤25s until commands arrive). The page's **first poll after (re)connecting sends `hello:1`**, which the server answers immediately instead of parking — otherwise the page's `_agentLinked` flag (the Help panel's "Connected" status) lagged the real connection by up to the 25s hold (`test/regression_agent_help_status.mjs`). Server keeps a command queue + per-command waiters (20s timeout); API callers get 503 when no page has polled recently, 502 when the page reports a command error.
2. **REST API** — `GET /api/health|chart|bars|indicators|alerts|drawings`, `POST /api/drawings`, `DELETE /api/drawings/<id>` / `?llm=1` — each is a thin proxy to a bridge command.
3. **MCP stdio** (`--mcp` flag) — hand-rolled newline-delimited JSON-RPC (initialize / tools/list / tools/call); 7 tools (`get_chart`, `get_bars`, `get_indicators`, `get_alerts`, `list_drawings`, `add_drawings`, `remove_drawings`) that call the REST API over HTTP, so `--mcp` **attaches to an already-running server** on EADDRINUSE (standalone server + several MCP clients coexist). stdout is reserved for MCP; logs go to stderr.

It also static-serves the repo (so `http://127.0.0.1:8787/` opens the app same-origin), with a path-traversal jail and a refusal to serve dotfiles/`.env*`.

**Hardening:** Host-header allowlist (`localhost|127.0.0.1|[::1]` — blocks DNS-rebinding), Origin allowlist (only localhost/`file://` pages may call from a browser; hostile origins get 403 and no CORS headers), fixed command allowlist on both ends (no eval/code path), 512KB body cap, bounded queue, optional shared secret (`OPENVIEW_TOKEN` env ↔ `X-OpenView-Token` header).

### Page side — agent bridge (end of `index.html` script)

`agentLoop()` long-polls the server and executes commands via `agentExec(cmd, params)` — a fixed switch, everything else rejected:

| Command | Uses | Returns |
|---|---|---|
| `chart.info` | `activeSymbol/activeTF/chartType/lastData`, `getVisibleRange()` | symbol, tf, bar count, last bar, visible range, drawing counts |
| `chart.bars` | active `lastData` when symbol+tf match, else `fetchTfBars` | OHLCV rows (times in UNIX sec, oldest first, limit ≤1500); validates symbol regex + TF key |
| `chart.indicators` | `MAS`/`maLine`, `rsiSeries`/`RSI_PARAMS`, `indicators[]` | MA kinds/periods/current values, RSI, indicator params (read-only) |
| `alerts.list` | `alerts[]` | sanitized alert list (read-only) |
| `draw.list` | `draw.shapes` | all drawings; `llm:true` marks bridge-created ones |
| `draw.add` | `CLICKS` (type+point-count validation), `newId`, `snapshotDraw`, `persist`, `redraw` | validate-first/all-or-nothing; shapes tagged `agent:true`; text/name `<>`-stripped + capped; ≤40/call, ≤400 total |
| `draw.remove` | same | removes **only `agent:true` shapes** (by ids or `llmOnly`); user drawings untouchable |

LLM drawings are ordinary shapes: they persist per symbol (`fv_draw_<sym>`), appear in the object tree, and undo with Ctrl+Z (a `snapshotDraw()` precedes every mutation). Gating: bridge runs only when `!IS_EMBED` **and** (localhost/`file://` origin, `?agent=1`, or `localStorage fv_agent="1"`); port override via `localStorage fv_agent_port`. On fetch failure it backs off 3s→30s silently, so running without the server costs nothing.

Regressions: `test/regression_agent_mcp.mjs` (MCP handshake, REST, hardening, fake-page long-poll) and `test/regression_agent_bridge.mjs` (real page end-to-end: reads, add/validate/remove, user-drawing protection).

---

## Next.js Migration (`web/` App Router) — 2026-07-11

> **Resume anchor.** If a session ends mid-migration, resume from here. Do NOT re-scaffold if `web/package.json` exists. State: migration complete + browser-verified (see "Verification" below).

### Goal & the one hard constraint

Wrap the site in a **Next.js 14 App Router** app under `web/`, adding marketing pages (Home / About / Contact / Portfolio) with a TradingView-style top navbar — **without changing the chart engine** and **without breaking the deployed engine that the mobile app and the multi-chart grid depend on.**

The binding constraint (verified in code, not assumed):

- **Mobile app** (`openviewapp/src/config.ts` → `chartEngineUrl = https://openview-opal.vercel.app`; `ChartWebView.tsx`) loads **`${base}/?embed=1&ev=&sym=&tf=`** — the **root path `/`** — and drives the engine by `injectJavaScript` **into the WebView's top frame** plus `originWhitelist=[engine origin]`. Therefore the root `/` **must serve the raw engine document** (an App-Router page that wraps the engine in an `<iframe>` would break top-frame injection and the origin whitelist).
- **Multi-chart grid** (`index.html:10439`) sets iframe `src="index.html?embed=1&sym=&tf="` (relative) → must resolve to the engine **with query params intact**.

### Decision (lowest-risk) — logged

1. **Engine is served byte-for-byte from `web/public/index.html`** (copied verbatim; `cmp` clean). Its 11,213 lines of logic are **unchanged**. Assets (`assets/`, `images/`) copied to `web/public/` so `/assets/*` resolve identically.
2. **Root `/` serves the engine** via a `next.config.js` `beforeFiles` rewrite `{'/' → '/index.html'}`. Next serves `public/index.html` **directly** at `/index.html` (200, no redirect) — strictly better than the old Vercel `/index.html → /` 308 hop; grid iframe `src="index.html?…"` now hits the engine directly with params preserved.
3. **"Chart engine as ONE `'use client'` component"** requirement is met by `web/app/chart/ChartEngine.tsx` — a `'use client'` wrapper that mounts the engine full-viewport in an iframe and forwards the query string; it backs the in-app **`/chart`** route (navbar use). The **canonical mobile / grid / embed contract stays on the raw `/` document** (never the iframe wrapper), which is why mobile keeps working untouched.
4. **Mobile app is NOT modified or redeployed** — lowest risk. Its URL (`/?embed=1…`) still lands on the engine. (The instruction allowed updating the mobile config in the same commit; not needed because the root contract is preserved.)
5. ~~**Supabase** lives only in `openviewapp` and is **not touched**.~~ **False since Reports Phase 2 (2026-07-16), and the "separate projects" framing was never true.** Web and mobile share **one** project, `koedodxkryyxizcryggy`. **→ §18** is authoritative; don't re-derive it here.

### Route map (`web/app/`)

| Path | Served by | Notes |
|---|---|---|
| `/` | `public/index.html` (rewrite) | **Chart engine, verbatim.** Mobile + grid + embed contract. |
| `/index.html?…` | `public/index.html` (static) | Grid iframe `src`. 200 direct, params preserved. |
| `/assets/*`, `/images/*` | `public/` | Engine icons, sounds, screenshots — same relative paths. |
| `/home` | `app/home/page.tsx` | **Landing page.** Hero-only "OpenView". |
| `/home/openview` | `app/home/openview/page.tsx` | Platform description (what OpenView is). |
| `/home/app` | `app/home/app/page.tsx` | The phone app. |
| `/home/docs` | `app/home/docs/page.tsx` | **Docs — AI assistant (MCP + API).** Full setup guide for the LLM bridge: quick start, MCP tool table, REST endpoints, config, security. Mirrors `mcp/README.md` — keep both in sync when the bridge API changes. The chart's Help panel links here rather than restating it. |
| `/home/about` | `app/home/about/page.tsx` | Who we are. |
| `/home/journal` | `app/home/journal/page.tsx` + `JournalShell.tsx` (`'use client'`) | **Trade journal dashboard** (folder-tab "Journal"): sidebar + Calendar/Notes. See §15. |
| `/home/assets` | `app/home/assets/page.tsx` + `AssetsShell.tsx` (`'use client'`) | **Assets dashboard** (folder-tab "Assets"): sidebar + Leaderboards (default) / Gainers & Losers. Same dashboard design as the wallet, **no Add Asset button**. Reuses the wallet's `MoversView` + `AssetDetailView` (§16). |
| `/home/wallet` | `app/home/wallet/page.tsx` + `WalletShell.tsx` (`'use client'`) | **Wallet dashboard** (folder-tab "Wallet"): sidebar + Wallet / Wallet Tracker. Leaderboards / Gainers & Losers moved to `/home/assets`. See §16. |
| `/home/reports` | `app/home/reports/page.tsx` + `ReportsShell.tsx` (`'use client'`) | **Reports dashboard** (folder-tab "Reports"): sidebar + four views — Dashboard (feed), Daily, Weekly, Monthly. The sidebar is the wallet's shell with a nav list but **no action button**. Same mount-once/keep-mounted tab discipline as `WalletShell`. See §17. |
| `/api/market/prices` | `app/api/market/prices/route.ts` | POST holdings → `{symbol: {price, change24h}}`. Server-side price proxy (§16). Rejects a non-positive Binance `lastPrice` (a listed-but-dead pair like DAIUSDT answers 200 with `"0.00000000"`, which would otherwise surface as a real $0 quote and read as a 100% loss). |
| `/api/market/klines` | `app/api/market/klines/route.ts` | GET `?symbol=BTC&range=7d` → `{points: [{t, close}]}`. Keyless Binance klines for the wallet's All-time-profit "BTC trend" line; symbol allow-list (BTC/ETH) only. |
| `/api/market/symbols` | `app/api/market/symbols/route.ts` | GET `{symbols:[{s,n,t,x}]}` — full US stock/ETF directory (~12.6k) from NASDAQ Trader's official `nasdaqlisted.txt` + `otherlisted.txt`, Yahoo-normalized (`BRK.B`→`BRK-B`, `$`-suffixed preferreds skipped), cached in-process 24h + single-flight (concurrent cold-cache requests share one fetch). Feeds the chart engine's Add-symbol catalog. |
| `/api/market/proxy` | `app/api/market/proxy/route.ts` + `upstream.ts` | GET `?url=` — same-origin proxy for the engine's CORS-blocked upstreams. **Strict allow-list** (api.kucoin.com, api.mexc.com, api.gateio.ws, api.kraken.com, www.okx.com, api.coingecko.com, query1.finance.yahoo.com), https + GET only; anything else 400. Redirects are followed by hand (`redirect:'manual'`, max 3 hops) with every hop re-validated against the allow-list — no SSRF via upstream 3xx; non-JSON upstream content-types are forced to `application/json` so a compromised upstream can't serve HTML into our origin. Logic lives in `upstream.ts` (testable under plain node — `route.logic.test.mjs`). Not an open proxy. |
| `/api/market/coinlogos` | `app/api/market/coinlogos/route.ts` | GET `{base, ext, ids:{TICKER→cmcId}}` — symbol→CMC-id map (~7k tickers; pages CMC's keyless `data-api/v3` listing to rank 10 000, which overshoots its real end ~8.2k so nothing is truncated; 3-way page concurrency, 6h in-process cache + single-flight, never caches an empty map, CDN `s-maxage` 6h). Feeds the engine's icon chain (§chart-icons). |
| `/api/market/cmc` | `app/api/market/cmc/route.ts` | GET CoinMarketCap listing + spotlight + Fear & Greed — powers the market page's 6 crypto tabs (§16). No API key; see §16. |
| `/api/market/global` | `app/api/market/global/route.ts` | GET `{marketCap, marketCapChange24h, marketCapSeries:{t,v}[], fearGreed, altcoinSeason}` — the three snapshot cards (`home/GlobalStats.tsx`) shown above the **crypto** Leaderboards table (`MoversView`, crypto class only). `marketCapSeries` is a **4-year daily** series (~1460 pts via an explicit `timeStart`/`timeEnd` window with `interval=1d`; `range` caps at ~400 pts so it can't reach 4y) powering the Market Cap sparkline's hover crosshair/tooltip — the ▲/▼ badge stays the 24h change from the *latest* endpoint, only the sparkline is long-range. Keyless CMC `global-metrics` (latest + historical) + `altcoin-season/chart` + CMC `public-api/v3/fear-and-greed/latest`; each source fails soft, 60s cache. |
| `/api/market/screener` | `app/api/market/screener/route.ts` (+ `stocks.ts`) | GET `{stocks, etfs, commodities}` — the non-crypto Leaderboards universes (§16). Keyless: Nasdaq's screener returns 500 market-cap-ranked US stocks in **one** request, of which `stocks.ts` keeps the ~476 that are *common equity* (preferred shares and notes carry the issuer's market cap and would rank as a second copy of the company) and preserves the share class in the name (`Alphabet Inc. (Class A)`) so `GOOGL`/`GOOG` don't render identically; ETFs (40, curated) and commodity futures (16) are priced per-symbol off Yahoo. The size column is filled from Yahoo's crumb-gated `quoteSummary` — **AUM** for ETFs, **notional value** (open interest × price × contract size) for commodities, which have no market cap. |
| `/api/market/exchange-movers` | `app/api/market/exchange-movers/route.ts` | GET `?venue=coinbase\|bybit` → `{venue, rows:{symbol,pair,price,change24h,volume}[]}` — per-exchange spot tickers for the Reports pairs table's exchange tabs (§17.5). Keyless, one upstream request per venue: Coinbase `products/stats` (Δ = last vs open, base volume × last ≈ $ volume), Bybit `v5/market/tickers?category=spot` (`price24hPcnt`, `turnover24h`). Dollar quotes only (USD/USDT/USDC), deduped per base asset on volume, Bybit leveraged tokens (`…[2-5][LS]`) dropped, 60s cache, fails soft to stale-or-empty. **Bybit only returns data because functions are region-pinned to `fra1` — Bybit 403s all US IPs** (see §Region pin). |
| `/api/market/asset` | `app/api/market/asset/route.ts` (+ `descriptions.ts`, `tokenized.ts`) | GET `?cls=crypto\|stocks\|etfs\|commodities&symbol=…\|id=…&range=24H\|7D\|1M\|1Y\|ALL&mktPage=N` → one **asset detail** payload (quote, price series, stats, links, description, markets) for the page a leaderboard row opens into (§16.1). Keyless; normalises all four classes onto a single shape. **Every** class carries a description (crypto→CMC, stocks→Nasdaq, commodities→Wikipedia, ETFs→hardcoded); crypto carries a markets table, and a commodity with a tokenized proxy (gold→XAUt) carries a real CEX/DEX one for **the token** (§16.2). |
| `/api/wallet-tracker` | `app/api/wallet-tracker/route.ts` | POST `{action: balance\|tokens\|prices}` — on-chain lookups across 16 chains (§16). |
| `/api/explorer` | `app/api/explorer/route.ts` (+ `chains.server.ts`, `normalize.ts`) | POST `{action: address\|tx\|families}` — multi-chain **transaction** Explorer (§16.3). `address`→recent txns, `tx`→one tx's detail, both normalised to one `ExplorerTx` shape. Keyless: EVM via Blockscout (`eth/arbitrum/base/polygon`), Solana/Sui/Cardano/NEAR via each chain's public RPC/REST; chains with no keyless tx list (bsc/avalanche/optimism/tron) return `{deepLinkOnly:true, deepLink}` for a "View on explorer" link. Same never-leak-upstream-error contract as `/api/wallet-tracker`. |
| `/api/reports/preview` | `app/api/reports/preview/route.ts` (+ `_lib/`) | GET `?period=daily\|weekly\|monthly` — builds one market report live (CMC gainers + Binance pairs + sentiment + LLM analysis) and returns it, **without** persisting. 3 h TTL cache + single-flight; `maxDuration = 60`. Cache **hits** are never throttled; a **miss** is rate-limited 20/IP/min, and an empty build is cached for 60 s (never caching it let a transient upstream failure starve the cache and turn every request into a full rebuild). The client's fallback when no stored report exists. See §17. |
| `/api/reports/cron` | `app/api/reports/cron/route.ts` | GET, Vercel cron `0 18 * * *` (= 1 PM Cancún, UTC-5 no DST). Builds + upserts daily, `+weekly` on Mondays, `+monthly` on the 1st. `CRON_SECRET` bearer (see §17.4 on the non-latin-1 trap). Idempotent on `(period, report_date)`. |
| `/api/reports/generate` | `app/api/reports/generate/route.ts` | POST `{period}` — manual build+save, same code path as the cron. **Requires the `CRON_SECRET` bearer** (it triggers the same ~25s CMC+Binance+LLM pipeline; it shipped open at first, which made it a public quota-burn button). Also globally throttled 1/period/5 min as a second layer. |
| `/api/reports/list` | `app/api/reports/list/route.ts` | GET `?period=&limit=` — the feed (anon-key read). Omit `period` for all periods by recency. Returns `{reports, configured}`; `configured:false` when Supabase env is absent, which makes the client fall back to `preview`. |
| `/api/reports/[id]` | `app/api/reports/[id]/route.ts` | GET — one report + its comments + reaction tallies in one round trip. UUID-validated. |
| `/api/reports/comment` | `app/api/reports/comment/route.ts` | POST `{reportId,nickname,body}` — service-role write, validated, 5/IP/10 min. |
| `/api/reports/react` | `app/api/reports/react/route.ts` | POST `{reportId,emoji,op?}` — atomic `increment_reaction()`/`decrement_reaction()` RPC (`op` `add` default / `remove`), emoji allow-list, 20/IP/10 min. |

`/home/*` share `app/home/layout.tsx` → dark folder-tab bar (`OvTabs`, tabs: Home · Openview · Journal · Wallet · Reports) + heading nav (`app/home/HomeNav.tsx`: Home · Openview · APP · Docs · About us). `OvTabs` is a client component that derives the active tab from `usePathname()`. The raw engine tab bars (`index.html`, `web/public/index.html` `#ovTabs`) mirror the same tabs (Journal/Wallet/Reports link to `/home/journal`, `/home/wallet`, `/home/reports`). Each folder-tab dashboard route must be added to the `startsWith` path guards in **both** `HomeNav.tsx` and `HomeFooter.tsx`, which self-suppress on those paths. The nav "Openview" is the **description** page (`/home/openview`), NOT the chart — the chart is the folder-tab "OpenView" → `/`. Old `(site)` navbar pages (`/about`, `/portfolio`, `/contact`) are unrelated leftovers.
| `/about` | `app/(site)/about/page.tsx` | Marketing copy. |
| `/portfolio` | `app/(site)/portfolio/page.tsx` | Project cards. |
| `/contact` | `app/(site)/contact/page.tsx` + `ContactForm.tsx` (`'use client'`) | `mailto:` form, no backend, no stored data, no secret. On submit shows a confirmation panel with a copy-to-clipboard address as the fallback for machines with no mail client (the `mailto:` gives no callback). |
| `/chart` | `app/chart/page.tsx` + `ChartEngine.tsx` (`'use client'`) | Full-viewport engine iframe for in-app nav (no navbar). |

**Folder-tab bar (Home ↔ OpenView):** a dark, browser-tab-style bar. It exists in TWO places kept visually identical: (1) injected into the chart engine as `#ovTabs`, first child of `<body>` in `index.html` — `html:not(.embed) #app` shrinks to `calc(100vh - 34px)` to make room, and `html.embed #ovTabs{display:none}` hides it so the **phone app / grid panels (embed=1) show only the chart, no tabs**; (2) the React `app/OvTabs.tsx` component used by `/home`. The "OpenView" tab → `/` (chart), "Home" tab → `/home`. Styles mirror each other (`.ov-tabs`/`.ov-tab` in globals.css ≡ `#ovTabs` in index.html).

Layout structure: `app/layout.tsx` (root `<html><body>`), `app/(site)/layout.tsx` (adds `Navbar` — used by /about, /portfolio, /contact only; /home is standalone with `OvTabs`). The `(site)` route group scopes the navbar to marketing pages; `/chart` sits outside it (full-viewport, no navbar). Site chrome CSS in `app/globals.css` mirrors the engine's TV colour vars. Single client-nav component `app/Navbar.tsx` (uses `usePathname` for the active link; "Open Chart" is a plain `<a href="/">` so it does a real navigation to the static engine).

**The purple background wash (`.ov-home-bg`).** Every `/home/*` page — hero, docs, journal, wallet — sits inside this one element, which paints the site's background: a top-down fade out of the flat tab bar, plus two soft purple radials over `--bg`. The radials are **viewport-anchored** (`background-attachment: scroll, fixed, fixed` — the fade stays in flow so it lines up with the tab bar; the radials pin to the viewport).

That attachment is load-bearing, not decoration. `.ov-home-bg` is `flex: 1 0 auto`, so it grows to fit its content, and a radial positioned at `30%` of a *tall* box lands far below the fold. The short pages hid this (the wallet is ~870px, so its radials sat right in view), but the wallet's **Leaderboards board runs ~5,600px** of table: the `at 80% 30%` radial got pushed to y≈1,690px and, being only ~500px tall, ran out entirely — so everything past roughly the first 2,000px scrolled onto flat `--bg` and the board looked like it had lost the site's background. Pinning the radials to the viewport keeps the wash behind the content at **any** page height and leaves the short pages pixel-identical. Any future full-height `/home/*` view inherits this for free; a *new* background layer added here should stay `fixed` for the same reason.

### Link previews (Open Graph / Twitter cards)

Sharing an Openview URL on Facebook / WhatsApp / X / Slack shows a large image card. The preview image is **`web/public/assets/banner.png`** (1428×798, ~1.79:1 — close enough to the 1.91:1 OG ratio that no crop artefacts appear). Source of truth for the asset is `assets/banner.png` at the repo root; the copy under `web/public/assets/` is what actually ships.

Two places declare the tags, because **two different documents serve pages**:

1. **`app/layout.tsx`** — `metadata.openGraph` + `metadata.twitter` on the root layout, so every App Router page (`/home/*`, `/chart`, `(site)`) inherits them. `metadataBase: new URL('https://openview.site')` is what turns the relative `/assets/banner.png` into the **absolute** URL crawlers require — without it Next emits a relative `og:image` and every scraper silently drops the card. Per-page `export const metadata` in the route files only overrides `title`; Next merges the rest down from the root, so the image survives.
2. **`web/public/index.html`** — the static chart engine bypasses the Next layout entirely, so it carries its own hand-written `og:*` / `twitter:*` `<meta>` tags with **fully-qualified** `https://openview.site/...` image URLs.

Note the interaction with the root redirect (see `next.config.js`): a bare `openview.site/` **307s to `/home`**, and crawlers follow that redirect — so in practice the card a shared root link renders comes from `/home` (i.e. from `app/layout.tsx`), not from the engine. The engine's own tags only apply on `/?embed=1&…`, which is an iframe contract nobody shares socially; they exist for completeness.

Gotcha: Facebook and WhatsApp cache scrape results aggressively. After changing the banner or the tags, re-scrape via Facebook's Sharing Debugger (developers.facebook.com/tools/debug) — otherwise the old (empty) preview persists for days. `og:url` is **self-referential** (derived per-route from `metadataBase`, never hardcoded to the bare domain): a fixed `og:url` makes every page advertise `openview.site` as its canonical entity, so a shared `/home` link resolves against a different FB cache key than the debugger re-scrapes and the composer keeps serving a stale attachment.

WhatsApp constraints (per Meta's link-previews doc): image ≥300px wide, aspect ratio ≤4:1, file <600KB — `banner.png` (1428×798, 1.79:1, 230KB) clears all three. WhatsApp reuses `og:image` (there is no square-image tag) and may center-crop it for the thumbnail, so **keep vital content inside the centre square** of any future banner.

**Brand icon:** `assets/openview.png` (256×256), formerly `freeview.png` — renamed to match the Openview brand. Referenced by both `index.html` files (favicon, apple-touch-icon, tab-bar brand logo), `app/Navbar.tsx`, `app/OvTabs.tsx`, and `app/layout.tsx`. The favicon `.ico` is still `freeview.ico` (unchanged), and the screenshot download filename is still `freeview-<symbol>-<tf>.png`.

### Key files

```
web/
  package.json         next 14.2.5, react 18.3.1 (pinned, minimal deps)
  next.config.js       beforeFiles rewrite '/' -> '/index.html'
  tsconfig.json        strict; @/* -> ./
  vercel.json          { framework: "nextjs" }
  .eslintrc.json       extends next/core-web-vitals (so `next lint` doesn't prompt in CI)
  app/
    layout.tsx         root <html><body>, favicon = /assets/freeview.ico + /assets/openview.png,
                       OG/Twitter link-preview tags (banner.png), self-referential canonical
    globals.css        site chrome (navbar/hero/cards/form), TV colour vars
    Navbar.tsx         'use client' — TV-style top nav
    (site)/layout.tsx  wraps pages with <Navbar/>
    (site)/home|about|portfolio|contact/page.tsx
    (site)/contact/ContactForm.tsx   'use client' mailto form
    chart/page.tsx + chart/ChartEngine.tsx   'use client' engine wrapper (/chart)
  public/
    index.html         ENGINE, byte-identical copy of repo-root index.html
    assets/  images/   engine assets, verbatim
```

### Deployment (Vercel)

The Vercel project `openview` (`prj_f2yudtwYJ8U2jqVto56AEq8itBkj`) has **Root Directory = `web`** (confirmed via `vercel project inspect openview`). Consequences that are easy to get wrong:

- **`web/vercel.json` is the live config. The repo-root `vercel.json` is dead** — Vercel reads `vercel.json` from the Root Directory, so the root file (the pre-migration static config: `cleanUrls`, `/` → `/index.html`) is never read. Anything added there — crons, headers, rewrites — is **silently ignored**. Put deploy config in `web/vercel.json`.
- The repo-root `index.html` is still the source of truth that `web/public/index.html` is copied from — keep them in sync on engine edits (see Engine-sync note).

#### Serverless region is pinned to `fra1` — exchange APIs geo-block US datacenter IPs

`web/vercel.json` sets `"regions": ["fra1"]` (Frankfurt). This is **load-bearing, not a latency tweak**: from Vercel's default US region, the exchange APIs the server routes call are geo-blocked and return no data —

- **`api.binance.com` → HTTP 451** ("Service unavailable from a restricted location"). This silently zeroed the daily report's Binance pairs (`_lib/binance.ts`) and would break `api/market/prices`' Binance quote.
- **Bybit → HTTP 403** on *every* host (`api.bybit.com`, `api.bytick.com`, `api.bybit.nl` — all fronted by the same CloudFront country block), leaving the Reports Bybit tab (`api/market/exchange-movers`) permanently empty.

Both return 200 from `fra1` (verified). Two independent mitigations are in place, keep both:
1. **Region pin** unblocks Bybit (no non-blocked Bybit host exists) and is the primary fix.
2. **`_lib/binance.ts` and `api/market/prices` also use `data-api.binance.vision`** — Binance's official public market-data mirror (same `/api/v3/*` shapes, keyless, globally reachable). Belt-and-suspenders so a region change doesn't silently re-break Binance.

Coinbase (`api.exchange.coinbase.com`) is not geo-blocked and needs neither. If you ever move the region, re-probe all three upstreams first — a US region will 451/403 Binance+Bybit again.

### Keep-alive cron (Supabase free-tier anti-pause)

Supabase pauses a free-tier project after **7 days with no database activity**. A Vercel cron performs a real daily read so the timer never elapses.

| Piece | Where |
|---|---|
| Route | `web/app/api/keep-alive/route.ts` — App Router, `runtime = 'edge'`, `dynamic = 'force-dynamic'` |
| Cron | `web/vercel.json` → `crons: [{ path: "/api/keep-alive", schedule: "0 9 * * *" }]` |
| Table | `public.keep_alive` — one `note text` column, one row; RLS on, policy `keep_alive_select_anon` grants SELECT to `anon`/`authenticated` |

- **Real read, not a stub.** The route issues `GET {SUPABASE_URL}/rest/v1/keep_alive?select=note&limit=1` with the **anon key only** (never `service_role`) — plain `fetch` against PostgREST, i.e. the same request `@supabase/supabase-js` would make, without adding the client dependency to a deliberately minimal app. A route that merely returned `{ok:true}` would keep the cron green while the DB still got paused; **zero rows also returns 500**, so a deleted row or broken RLS policy surfaces instead of reporting a false success.
- **Auth.** Vercel injects `Authorization: Bearer $CRON_SECRET` when it fires a cron. If `CRON_SECRET` is set, a mismatched/absent header → **401**; if it is unset, the route stays open (cron still works) rather than failing deploys before the env var is added.
- **Hobby-plan limit: once per day, max.** More frequent schedules fail the deployment. Cron times are **UTC-only** and approximate on Hobby (fires within the hour).
- **Requires two env vars in Vercel** (Project → Settings → Environment Variables): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. These were **not present in the repo** at the time this was added (no `.env*` file exists) — without them the route returns 500 and the DB still pauses. Plus `CRON_SECRET` (any long random string) to lock the endpoint.
- **Framework Preset must be Next.js.** `vercel project inspect` reported Preset **"Other"** with Output Directory `public` — a static-site config that does not run App Router API routes. It must be Next.js (or auto-detected) or the cron will 404.

### Engine-sync note

`web/public/index.html` is a **copy** of the repo-root `index.html`. Any future engine change must be applied to the root file and re-copied (`cp index.html web/public/index.html`), or the copy replaced by a Next build/prebuild step. Bump `ENGINE_VERSION` in `openviewapp/src/components/ChartWebView*.tsx` when the deployed engine changes (existing convention).

### Verification

Servers: original engine on `:5501` (python) vs Next app on `:5599` (`next start`), same engine bytes.

- **Routing contract:** `curl` — `/` → engine 200; `/?embed=1&sym=&tf=` → engine 200; `/index.html?embed=1&…` → engine 200 with params intact (no redirect); `/assets/*` (icons + `zelda.mp3`/`route1.mp3`) 200 with correct MIME.
- **A/B engine parity:** `test/verify_nextjs_migration.mjs` — **17/17 PASS on BOTH** 5501 and 5599 (identical), incl. 15-canvas render, embed mode (embed class applied, watchlist hidden, no page errors), grid-iframe engine render, no fatal console errors. Same result on both servers ⇒ engine behaves identically under Next.
- **Site pages:** all of `/home /about /portfolio /contact` render navbar + heading, zero page errors; `/home` carries no engine bundle (clean isolation).
- **`/chart` wrapper:** engine loads inside the iframe (`/?sym=ETH-USD&tf=1h`, query forwarded), 15 canvases, full TV chrome — confirmed by screenshot.
- **Deep interactive sweep** (`test/verify_nextjs_deep.mjs`): **PARITY OK** — 5501 vs 5599 matched exactly on 16 chart types, 14 timeframes, 77 indicator entries / 8 categories, 11 draw tools, 11 watchlist rows, alerts present, Script/Pine present, 25 layout variants, 2-chart grid → 2 iframes, 0 real errors. Covers features.md §§1–13, 15–19.
- `next build` clean (6 static routes generated, no type errors); `next lint` clean; `tsc --noEmit` clean.

### Post-migration self-review (fixes applied)

A code-quality/security pass over `web/app/**` produced three fixes (re-verified: 17/17 + PARITY OK still hold):
- `chart/ChartEngine.tsx` — was `useState('/')` + effect → loaded the 704KB engine **twice** on `/chart?…`. Now lazy-inits `src` to `null` and renders the iframe only after the effect resolves the query → **single load** (verified: 1 navigation, params preserved, 15 canvases).
- `(site)/home/page.tsx` — the `/about` link is now `next/link` (client transition + prefetch); the `/` link stays a plain `<a>` (raw engine, not a page). Redundant page-level `metadata` dropped (inherits root layout).
- `.eslintrc.json` + `eslint`/`eslint-config-next` devDeps added so `next lint` runs non-interactively.

Security review confirmed clean: no secrets/keys/creds anywhere in `web/` source; the contact `mailto:` handler `encodeURIComponent`s the fully-composed subject/body, neutralizing header/body injection; no `dangerouslySetInnerHTML`/`eval`; iframe is first-party same-origin. `web/public/index.html` verified byte-identical to root `index.html`.

## 15. Journal — Trade Dashboard (`/home/journal`)

A trade-journal dashboard ported from the **Reach** desktop app, rendered inside the existing Journal folder-tab: a left sidebar (New Trade · Calendar · Notes · live clock) beside the active view. Layout parity is deliberate — the calendar is Reach's `TradingMonthView` (four stat cards over an 8-column grid: 7 day columns + a weekly-summary column) and the notes board is its `NotesView`. Reach's theme vars are mapped onto this app's tokens (`--panel`/`--border`/`--muted`), profit/loss reuse the engine's `--green`/`--red`, and Reach's blue `--accent-gradient` is rebuilt from `--accent`, so the dashboard reads as the same product as the chart.

**No new dependencies** — Reach uses `date-fns` + `lucide-react`; both are avoided. The date math is hand-rolled, the cumulative chart is an inline SVG (no chart lib), and the handful of Lucide glyphs used are inlined as SVG paths in `icons.tsx`. `/home/journal` costs **7.78 kB** (94.8 kB First Load).

### Files

| File | Role |
|---|---|
| `web/app/home/journal/page.tsx` | Server component; renders `<JournalShell/>` inside `<main className="ov-journal">`. |
| `web/app/home/journal/JournalShell.tsx` | `'use client'` — owns the active view (`calendar`/`notes`); lays out sidebar + content. |
| `web/app/home/journal/Sidebar.tsx` | `'use client'` — New Trade button, Calendar/Notes nav, live clock + date badge. |
| `web/app/home/journal/TradingCalendar.tsx` | `'use client'` — calendar UI, stats, the SVG chart, and the right-click menu. |
| `web/app/home/journal/TradeModal.tsx` | `'use client'` — the Add Trade dialog (form + live P&L preview). |
| `web/app/home/journal/NotesView.tsx` | `'use client'` — notes board: search, pinned/other sections, color picker, note form, right-click menu + read-only viewer. |
| `web/app/home/journal/trades.ts` | `Trade` type + `loadTrades()` / `saveTrades()` / `addTrade()` / `deleteTrade()`. |
| `web/app/home/journal/notes.ts` | `Note` type, `NOTE_COLORS`, `isLightColor()` + notes CRUD. |
| `web/app/home/journal/icons.tsx` | Inlined Lucide SVG paths (`<Icon name=… />`) — avoids the `lucide-react` dependency. |
| `web/app/home/useSidebarResize.ts` | `'use client'` — shared drag-to-resize + collapse hook for **both** dashboard sidebars. |
| `web/app/globals.css` | Calendar, sidebar, and notes styles appended under "Journal" banner comments. |

### Sidebar

Two nav items (Calendar, Notes) drive `JournalShell`'s `view` state; only the active view is mounted (both re-read localStorage on mount, so nothing is lost by unmounting). **New Trade** switches to the calendar and bumps a `newTradeSignal` counter that `TradingCalendar` watches to open `TradeModal` on the selected day — a counter rather than a boolean, so repeat clicks re-open without needing a reset. The clock ticks once a second and, like the calendar's month, stays `null` until mount to avoid a hydration mismatch against the server's clock.

#### Resize + collapse (`useSidebarResize`)

Both the journal and wallet sidebars are **drag-resizable** and **collapsible**, driven by one shared hook so they behave identically:

- **Drag** — a 6px `role="separator"` handle straddles the sidebar's right border (`.sidebar-resize-handle`). Pointer events are bound to `window` on `pointerdown` so the drag survives the cursor leaving the element; width is clamped to **180–420px**. Arrow keys resize from the focused handle (±8px, ±32px with Shift); double-clicking it collapses.
- **Collapse** — the `.sidebar-collapse-btn` toggle snaps the column to a **64px icons-only rail** (`.journal-sidebar.collapsed` hides `.sidebar-label`, the brand block, and the clock's date lines; nav buttons and the action button center their icons and gain `title` tooltips).
- **Persistence** — `{width, collapsed}` is stored per-dashboard in localStorage (`openview:journal-sidebar` / `openview:wallet-sidebar`), read in an effect (not during render) so SSR markup can't mismatch, and re-clamped on read so a corrupt or out-of-range value falls back to the 244px default rather than breaking the layout.
- **Mobile** (`max-width: 900px`) — the sidebar is already a full-width top bar, so the handle and toggle are hidden and the stored width is overridden; a sidebar left collapsed on desktop still renders with full labels here.

Reach's other nav items (Wallet, Trading View, Quant, Gainers & Losers, Heatmap, Wallet Tracker, News/X), its REACH brand header, the personal/trader mode toggle, and the **Customize** panel are all deliberately **omitted** — Customize only configures a crypto/forex widget that isn't ported, so it would have been dead UI.

### Notes interactions

- **Left-click** a card → opens the **editor** (`.note-form`), pre-filled.
- **Right-click** a card → a **context menu** (View · Edit · Delete), reusing the calendar's `.calendar-context-menu` styling. It is clamped to the viewport, and dismissed by any click, scroll, resize, or Escape.
- **View** → a **read-only viewer** (`.note-view`): the full title, the **complete content** (note cards truncate at 150 chars — the viewer does not), the pin indicator, and Created/Updated dates. No inputs, nothing editable. Closes on the ✕, Escape, or a click outside. On a colored note the panel takes the note's color, and the muted/rule colors are derived from its luminance so text stays legible.

### Data model — `Note`

Mirrors Reach's SQLite `notes` table: `id`, `title`, `content`, `color` (one of `NOTE_COLORS`, or `null`), `pinned`, `created_at`, `updated_at` (ISO). Persisted at `ov_notes` (§9), sorted pinned-first then most-recently-updated — Reach's `ORDER BY pinned DESC, updated_at DESC`. Every mutation re-reads storage before writing, so a change in another tab isn't clobbered. A blank note (no title *and* no content) is a no-op. Card text flips to dark on light backgrounds via `isLightColor()` (luminance > 0.55), matching Reach.

### Data model — `Trade`

Mirrors Reach's SQLite `trades` columns (snake_case) so trades stay portable between the two apps: `id`, `trade_date` (`'YYYY-MM-DD'`), `symbol`, `direction` (`long|short`), `asset_class`, `entry_price`, `exit_price`, `position_size` (USD **margin/collateral** — the modal field is labelled "Margin (USD)"), `pnl` (**already net of commissions**), `commissions`, `margin` (leverage multiplier; notional = `position_size × margin`), `trade_type` (`spot|futures`), `amount_asset` (spot only, else `null`), `is_open`, `setup_tag`, `notes`.

Persisted at `ov_trades` (see §9). `loadTrades()` returns `[]` on the server, on missing/corrupt JSON, or if storage is blocked, and coerces every field — a malformed entry is dropped, never thrown. `saveTrades()` writes the whole list back (silently no-ops if storage is blocked/full). `addTrade()` **re-reads storage before appending** and derives the new `id` from the current max, so a write from another tab is never clobbered by a stale in-memory copy.

### Adding a trade

**Right-click any day cell** → a context menu with **+ Add Trade** → `TradeModal`, prefilled with that cell's `'YYYY-MM-DD'` key (the date is fixed; everything else is entered). Dismiss the menu with a click anywhere, a scroll, a resize, or Escape; it is `position: fixed` at the cursor and clamped back inside the viewport so it never opens off-screen.

`pnl` is derived by `computePnl()` in `trades.ts` (called from the modal, not the calendar, which only aggregates — the extraction keeps it unit-testable under plain node: `journal/pnl.logic.test.mjs`). Quantity = `(position_size × margin) / entry_price` where `margin` is the leverage multiplier — so $1k margin at 10× from 100 → 110 nets $1,000 (ten times un-leveraged); the move is `exit - entry` (long) or `entry - exit` (short), minus commissions. The footer shows this live. Checking **Still open** disables the exit field and forces `pnl` to 0 — consistent with the aggregation rule below. `amount_asset` is filled for spot only (notional `size × margin / entry`), `null` for futures.

### Aggregation rules

- **Open trades** (`is_open`) count toward a day's *trade count* but contribute **no P&L** to any total.
- **Month totals** are scoped with `isSameMonth`, so the adjacent-month padding days visible in the grid never leak into Net P&L / win %.
- **Trade Win %** = winning ÷ closed trades; **Day Win %** = winning ÷ trading days (a day wins if its summed P&L > 0). Breakeven (`pnl === 0`) is tracked as its own bucket in both gauges.
- **Daily Net Cumulative P&L** is a running sum, one point per trading day in date order; it renders "Not enough data" below 2 points. Y-axis ticks snap to a `[1,2,2.5,5,10]×10ⁿ` step.
- Dates are parsed as **local** (`new Date('YYYY-MM-DDT00:00:00')`) and keyed without `toISOString()`, so no trade shifts a day across timezones.

The current month depends on the client clock, so the component renders an empty shell until mount (`useState(null)` + `useEffect`) rather than risk a hydration mismatch. A `storage` listener keeps the calendar live if trades are written in another tab.

### Scope / not built

Only the **month view** exists — the Day/Week toggle buttons are present but `disabled`. Trades can be **added** (sidebar New Trade, or right-click a day → modal) and **deleted** (right-click a day with trades → "Manage Trades…" → per-row Delete, backed by `deleteTrade()`), but not yet **edited** from the UI. Notes are fully CRUD. Reach's undo/redo, Ctrl+scroll zoom, sidebar drag-to-resize, and the Customize/finance widget were left out, as were its other nav destinations (Wallet, Trading View, Quant, Gainers & Losers, Heatmap, Wallet Tracker, News/X). Unlike Reach there is no auth/user scoping (no `user_id`) — trades and notes are per-browser, in localStorage.

## 16. Navigation Performance (folder tabs)

Measured in production (`next build` + `next start`), click → content visible:

| Transition | Time | Notes |
|---|---|---|
| Home ↔ Journal ↔ Wallet | **48–139 ms** | Client-side `<Link>`. Zero network requests — the pages are statically prerendered and prefetched. Nothing to optimize. |
| → Openview (chart engine) | **1310 ms cold → 122 ms warm** | A plain `<a href="/index.html">`: a **full document load** of the 720 KB single-file engine, not a client-side nav. |

The engine tab was the only real cost, and it broke down as ~713 ms parsing/executing the inline JS plus ~470 ms fetching coin icons from `assets.coincap.io`. TTFB was 9 ms — the server was never the problem. Two fixes:

1. **`preconnect` / `dns-prefetch` to `assets.coincap.io`** (in the engine's `<head>`) — the watchlist requests a dozen coin logos the moment it renders; warming DNS+TLS means the first one doesn't pay the handshake.
2. **Cache headers** (`next.config.js` `headers()`) — everything under `public/` defaulted to `Cache-Control: public, max-age=0`, so *every* jump back to Openview re-validated the whole 720 KB document and re-fetched its assets. Now:
   - `/index.html` → `max-age=0, must-revalidate, stale-while-revalidate=86400` (serve from cache instantly, revalidate in the background; a deploy lands on the next navigation).
   - `/assets/*`, `/images/*` → `max-age=604800` (a week).

Result: repeat visits to the Openview tab drop **1310 ms → 122 ms** (10×), with the document served from cache (0 KB transferred).

### `NEXT_DIST_DIR` — don't clobber the dev server

`next build` writes to the same `.next` the dev server serves its chunks from, so **running a production build while `npm run dev` is up silently breaks it** — every `/_next/static/*` asset 404s and pages render as unstyled HTML until the dev server is restarted. `next.config.js` now honours `NEXT_DIST_DIR`:

```bash
NEXT_DIST_DIR=.next-prod npx next build   # builds without touching the running dev server
```

---

## 16. Wallet — Portfolio, Movers, On-chain Tracker (`/home/wallet`)

A five-view dashboard ported from the **Reach** desktop app, replacing the old "Coming soon" placeholder. Reuses the Journal's shell (`.journal-shell` / `.journal-sidebar` / `.nav-item`) so both dashboards read as one product. Sidebar: **Add Asset** button · Wallet · Wallet Tracker · Explorer · Leaderboards · Gainers & Losers · live clock. The **Explorer** (§16.3) is a multi-chain transaction search — the only view added beyond Reach's set.

**Leaderboards and Gainers & Losers are the same component** (`MoversView`), rendered under two sidebar destinations via a `mode` prop. `mode="leaderboards"` renders the board standalone — no market tab row, since it's a sidebar destination in its own right; `mode="market"` renders the tab row **minus** Leaderboards, so the two never offer competing entry points to the same view. They are two separate instances, each with its own state and its own 30 s poll.

**Every view mounts on first visit, not at page load.** `WalletShell` gates each panel behind a `…Mounted` flag (`trackerMounted` / `explorerMounted` / `leaderboardsMounted` / `moversMounted`) flipped by `handleViewChange`; once mounted a panel is kept mounted and hidden with `display:none`, so a re-switch neither re-fetches nor loses state. Only `WalletView` mounts eagerly — it's the default view. This matters for the two boards in particular: mounting both up-front meant **each ran its own 30 s `/api/market/cmc` poll from first paint**, so landing on the wallet paid for two full 500-coin fetches and two board renders before the user had opened either. To keep the first *click* fast despite the lazy mount, the idle effect pre-warms the `MoversView` and `WalletTrackerView` chunks after the wallet paints (`requestIdleCallback`, falling back to a 1.5 s timer), so only the data — never the chunk — is fetched on demand.

`/home/wallet` costs **16.1 kB** (103 kB First Load). Movers, Tracker, Explorer and **AssetDetail** are `next/dynamic` code-split — none is needed for the wallet's first paint, and the detail page isn't reachable until a row is clicked.

Every leaderboard row is **clickable**, opening an asset detail page — see §16.1.

### The porting problem: Reach is Electron

Reach fetches **all** market and chain data in its Electron **main process**, behind `window.electronAPI` IPC (`wallet:getPrices`, `walletTracker:*`). None of it is reachable from a browser: the upstreams send no CORS headers, and `CLAUDE.md` forbids calling external APIs from client code regardless. Every data path was therefore re-homed into **Next.js API routes**. All upstreams are keyless — no new env vars.

| Concern | Reach (Electron main) | Here (API route) |
|---|---|---|
| Crypto price | Binance 24hr ticker | same, via `/api/market/prices` |
| Stock price | Yahoo v8 chart | same |
| **Metal price** | Swissquote spot — **no 24h reference, so Reach hardcodes `change24h: 0`** | **Yahoo futures** (`GC=F`/`SI=F`/`PL=F`/`PA=F`) → `regularMarketPrice` vs `chartPreviousClose` = a **real** 24h change |
| **Currency price** | Frankfurter `/latest` — **also `change24h: 0`** | Frankfurter `/latest` **diffed against the prior published session** = a real change |
| On-chain balance/tokens | Blockscout + public RPCs | same, via `/api/wallet-tracker` |
| Chain-native prices | CoinGecko free `simple/price` | same |
| **Market page (crypto)** | CoinMarketCap `data-api/v3` + CMC `public-api/v3` | same, via `/api/market/cmc` |

The metal/currency change is the one deliberate behavioural divergence, and it is **load-bearing**: a metals/FX gainers table sourced Reach's way would render every row at `0.00%` and the gainer/loser split would be meaningless. Verified live: 13 of 14 symbols return a non-zero 24h move.

### CoinMarketCap — no API key required

The market page's six crypto tabs are backed by CMC's **undocumented `data-api/v3` endpoints** — the
ones coinmarketcap.com's own frontend calls. They take **no API key**, but they *do* reject requests
without a browser `User-Agent`, and they send no CORS headers, so they can only be called
server-side. `/api/market/cmc` is that proxy. Two endpoints cover five tabs:

| Upstream | Feeds |
|---|---|
| `…/cryptocurrency/listing?…&sortBy=market_cap&limit=N` | Gainers & Losers, Leaderboards, Community Sentiment — all derived locally from this one ranked list |
| `…/cryptocurrency/spotlight?dataType=7&limit=30` | Trending + Most Visited (one call returns both) |
| `…/cryptocurrency/spotlight?dataType=8&limit=30` | Recently Added |
| `…/cryptocurrency/detail/chart?id=N&range=7D` | 7-day sparklines — the **Leaderboards → Crypto** `7d Price%` column |
| `pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest` | The Fear & Greed gauge on Community Sentiment. CMC's own index — deliberately not alternative.me's, which shares the name but uses a different methodology and prints a different number. |

⚠ `spotlight`'s `limit` is validated upstream to **5–30**; outside that range it returns a 400.

The Crypto leaderboard carries three extra columns the other classes don't: **Circulating Supply**
(with a max-supply progress bar — `circulatingSupply`/`maxSupply` come straight off the listing;
`maxSupply` is null for uncapped coins, so those show no bar), **Sentiment** (a Bullish/Neutral/Bearish
pill derived from the 24h move — `50 + pct*2` clamped, the same heuristic as the Community Sentiment
tab, since no accurate keyless per-coin sentiment feed exists), and a **7d Price% sparkline**. The
listing endpoint has no price history, so sparklines come from a **per-coin** `detail/chart` call —
run only for the **first-page** coins (`SPARKLINE_COUNT = 100`), capped at 8 concurrent, each series
downsampled to ~24 points, and cached on a **longer 5-min TTL** than the 30 s listing so the poll
doesn't re-fetch 100 charts each cycle. A dead chart just leaves that row without a spark; a total
sparkline failure keeps the previous map rather than blanking the column.

**Risk:** `data-api/v3` is undocumented and may change or rate-limit without notice. Every fetch
therefore fails soft — a dead endpoint yields an empty list, never a throw — the three sources are
fetched independently so one failure can't blank the others, results are cached 30 s (the client
polls at the same cadence), and a total wipeout is never cached.

**Single-flight — the cache alone wasn't enough.** A TTL cache only helps once it's *warm*; every
request arriving during a cold window still ran its own full upstream pass. `/api/market/cmc` and
`/api/market/screener` therefore keep an in-flight promise alongside the cache (`inflight`, keyed by
pool size for cmc; a single `inflightPass` for the screener): the first caller on a miss does the
work, every concurrent caller `await`s that same promise, and it's cleared in `finally` so a failed
pass never wedges the key. This matters most for the screener, whose cold pass is the most expensive
in the app (a Nasdaq screener call **plus** a per-symbol Yahoo chart *and* `quoteSummary` for every
ETF and commodity — ~112 requests against a rate-limited upstream). Measured: 4 concurrent cold
screener requests complete in 5.5 s wall clock total rather than four independent passes; 5
concurrent cold cmc requests share one 0.66 s pass.

⚠ **Both are per-instance module state.** They collapse the herd within one warm server, **not**
across serverless instances — N cold lambdas still make N passes. Same bound the TTL cache always
had; treat both as a cost reduction, never a global lock.

⚠ **`limit` is quantised, not just clamped — the cache key must never be attacker-chosen.** The old
handler clamped `limit` to `100..1000` but then used that value *as the cache/in-flight key*, so
sweeping `?limit=100,101,…,1000` minted ~900 distinct keys, each missing the cache, each bypassing
single-flight, each buying its own full CMC listing pass off one trivial script. `limit` now
quantises onto the only two sizes the client can actually ask for (`LISTING_SIZE = 500`, or
`ALL_POOL_LIMIT = 1000` for "All" — mirroring `MoversView`'s `LEADERBOARD_MAX` / `ALL_POOL_LIMIT`),
so an arbitrary `limit` can only ever land on a key that's already cached or already in flight.
Verified: `?limit=` 100/137/250/499 → 500 coins; 501/777/999/1000 → 1000 coins. **Any future
cache keyed off a query param needs the same treatment** — clamping bounds the cost of one request,
quantising bounds the number of distinct keys.

**The pool dropdown doesn't refetch.** `limit` is derived in render (`max(coinPool, 500)`) and
`fetchData` depends on **`limit`, not `coinPool`** — Top 100 and Top 500 both clamp to 500, so
switching between them is pure client-side filtering over coins already on screen instead of a
refetch that also restarts the 30 s interval. Only **All** (1000) genuinely widens the request.
Relatedly, the 30 s background poll no longer sets `loading` — it refreshes in place rather than
flipping a populated table back to "Loading…". A separate `refreshing` flag covers the two
**user-driven** fetches that would otherwise give no feedback: the manual refresh button, and the
pool switch to **All**, whose 1000-coin pass is the slowest request the board makes. Background
polls stay silent; anything the user actually clicked spins the indicator.

### 16.1 Asset detail — what a leaderboard row opens into

Every row on **every** board is clickable — the four Leaderboards classes (crypto / stocks / ETFs / commodities), Gainers & Losers, Trending, Most Visited, Recently Added and Community Sentiment. A click swaps the board for `AssetDetailView`: header quote, price chart with 24H/7D/1M/1Y/ALL range toggles, a stats grid, external links, a **description (every class — see below)**, and a markets panel.

The panel **replaces** the board rather than routing away from it. `WalletShell` holds the selected asset in state and hides the board with `display:none` rather than unmounting it, so **Back** restores the exact page, sort and 30 s-refreshed data the user left — an unmount would drop them onto a reloading table. `AssetDetailView` is `next/dynamic` code-split: nobody sees it until they click, so its chart code shouldn't ship with the shell.

**One route, four classes.** `/api/market/asset` normalises everything onto a single payload, so the view renders from one shape rather than four. The stats grid is **data-driven** — the route decides which tiles exist for a given asset and the UI renders exactly those, in order. A commodity has no market cap and no sector, so those tiles simply never arrive; nothing is faked to square the grid.

| Class | Sources (all keyless) | Stats |
|---|---|---|
| **crypto** | CMC `data-api/v3/cryptocurrency/detail` + `…/detail/chart` | 11 — market cap, FDV, dominance, supply (circ/total/max), 24h range, ATH (dated) / ATL, plus website / whitepaper / explorer / source links and the description |
| **stocks** | Yahoo `v8/chart` (series + quote) + Nasdaq `quote/{sym}/summary` (the fundamentals Yahoo gates behind a crumb) | up to 13 — market cap, volume, avg volume, day + 52 w ranges, dividend yield, 1 y target, sector, industry, exchange |
| **etfs** | same as stocks (`assetclass=etf`) | same, minus the tiles Nasdaq omits for funds |
| **commodities** | Yahoo only | 7 — a futures contract has no market cap, sector or dividend, so those are absent by design |

#### Descriptions — one source per class (`app/api/market/asset/descriptions.ts`)

Every class now has an **About** section, and each gets it from a different place because that is what actually exists behind a keyless endpoint. The invariant the module enforces: **a description is either about that exact asset, or it is absent.** A miss returns `''` and the section doesn't render.

| Class | Source | Why not something else |
|---|---|---|
| **crypto** | CMC's `detail` payload (already fetched) | — |
| **stocks** | Nasdaq `company/{sym}/company-profile` — a real per-company description | Live fetch, fails soft to `''` |
| **commodities** | Wikipedia REST, by **hardcoded article title** (16 of them, each opened and checked) | Search is unusable here — see below |
| **etfs** | **Hardcoded** in the module, matching the screener's 40-fund list | Nasdaq's profile API rejects the ETF asset class outright (`"Unsupported Asset Class"`) |

⚠ **A failed description is never cached — `Description` is tri-state.** This was a real, observed bug: on a cold start Wikipedia timed out, gold's empty payload went into the 60 s cache, and **every viewer got a gold page with no About section for a full minute** after Wikipedia had already recovered. The root cause was that `''` meant two different things. It now means exactly one:

| Value | Meaning | Cached? |
|---|---|---|
| `'…text…'` | the copy | ✅ |
| `''` | the source **answered** and has no copy for this symbol (an unlisted ETF, an unmapped commodity, a Nasdaq 200 with a null profile, a disambiguation page) — **permanent** | ✅ (re-fetching it every 60 s would be pure waste) |
| `null` | the fetch **failed** (timeout, 5xx, malformed body) — **transient** | ❌ the handler skips the cache write, so the next request retries |

`null` is flattened to `''` before the response leaves the route, so the wire format is always a string and the UI never sees it. Covered by `assetDetail.logic.test.mjs` plus a direct harness against the compiled module (stubbed timeout / 5xx / healthy / disambiguation / unmapped).

⚠ **Wikipedia *search* was rejected as a description source, and this is the whole reason the maps are hardcoded.** The search API never says "I don't cover this" — it returns the nearest keyword match with full confidence. Querying `"Schwab US Dividend Equity ETF"` hands back the **generic "Exchange-traded fund" article**; `"iShares Core MSCI EAFE ETF"` hands back the **iShares brand page**. Rendered under an *About SCHD* heading, that is a confident description of the wrong thing — strictly worse than no description, because the reader has no way to detect it. Commodity articles are therefore **pinned by symbol** (`CL → West_Texas_Intermediate`, not the generic "Crude oil" — Brent is a separate row on the same board), and the fetch rejects anything that isn't a `type: "standard"` page, which catches redirects to disambiguation stubs. The cost is that a new ETF lands with no description until someone writes one; that is the intended failure mode.

**Three bugs this surfaced, all covered by `app/home/wallet/assetDetail.logic.test.mjs` (19 tests):**

1. **Yahoo's `chartPreviousClose` is range-scoped, not daily.** It's the close preceding the *requested range* — on a 1Y chart, the price a year ago. The first cut derived `change24h` from it, so the "24h" change silently scaled with whichever chart window was open: **Gold read +1368 %** on the ALL range, AAPL +9.9 % on 1M. Fixed by fetching a **separate, fixed 5d/1d quote** (`yahooQuote`) purely for the previous close, so 24h change and Previous Close mean the same thing on every range. 5d rather than 2d because a holiday weekend can leave a 2-day window holding a single session.
2. **The chart line was coloured by `change24h`, not by the window on screen.** Those disagree constantly — Bitcoin is down 2 % on the day inside a decade that is up 100,000,000 % — so an ALL-range chart soaring off the top of the plot was painted **red**. The line now takes its colour from `last >= first` of the *displayed* series; the header pill keeps reporting the 24h change. They are allowed to disagree, and on ALL they correctly do.

**Share classes — three spellings, three upstreams.** The same security is written differently by each source, and each rejects the other two:

| Upstream | Wants | Rejects the others with |
|---|---|---|
| Nasdaq **screener** (where the row originates) | `BRK/B` | — |
| Yahoo **chart** | `BRK-B` | 404 on the slash → the row was a dead click (502) |
| Nasdaq **company-profile** | `BRK.B` | `"no data"` on the dash → chart rendered, **description silently empty** |

`yahooTicker()` does the dash; `nasdaqTicker()` (in `descriptions.ts`) does the dot. Both were real bugs, caught by hitting the live endpoints rather than by inspection — the profile one only appeared once descriptions were added, because a dash returns a *valid, empty* response rather than an error. (The icon layer normalises the same way — `baseTicker()` in `marketIcons.ts`.)

**Failure behaviour.** Each upstream fails soft and independently: a dead Nasdaq costs a few stat tiles, not the page. Bad input is rejected with a 400 before it reaches an upstream URL (crypto must supply a numeric CMC id; the rest must match `/^[A-Z0-9.\-/]{1,12}$/`), and an upstream error returns a bare `502` — never the error string, which can carry the URL we called. Payloads are cached 60 s per `(class, symbol, range)`, in a **bounded** map (200 entries, oldest evicted) so a long session can't grow it without limit.

**Chart rendering.** An inline SVG line, not a charting library — one series with a hover readout doesn't justify the bundle. It draws in a fixed 1000 × 260 user space and scales via `viewBox`, so no resize observer and no layout measurement. Two edge cases would otherwise produce a blank line, and both are tested: a **flat series** (a stablecoin pinned at $1.00 has zero span, and dividing by it puts every `y` at `NaN` — hence the `|| Math.abs(hi) * 0.01 || 1` fallback), and Yahoo's **null-padded gaps** for holidays and halted sessions, which are dropped rather than drawn down to zero.

**Everything that isn't the line is DOM, not SVG** — axis labels, the crosshair, the hover dot and the tooltip all live outside the `<svg>`, positioned in percent. `preserveAspectRatio="none"` scales the viewBox **non-uniformly** (measured: 1.036× horizontally, 1.000× vertically), so anything inside it is stretched along with the geometry: text would be smeared sideways, and a `<circle>` rendered as a visibly squashed **ellipse**. `vectorEffect="non-scaling-stroke"` does *not* save it — that spares the stroke, never the shape. Percent-positioned DOM sits above the stretch, so the dot measures a true 10 × 10 px at every point on the line. The overlay shares an `.ad-chart-plot` wrapper with the SVG so its percentages resolve against exactly the drawn area — measured against the card instead, its asymmetric padding (62 px on the right, for the y-axis labels) would shift every hover point sideways. The tooltip **follows the cursor** and flips to its left past the halfway mark so it can't overflow the card.

### 16.2 Markets — where you can actually buy the asset

Crypto and everything else get **different answers, because the two cases genuinely differ.** This is the one place a copy-CMC instinct would have shipped fabricated data.

**Crypto → a real markets table.** CMC's keyless `data-api/v3/cryptocurrency/market-pairs/latest` returns the venues actually trading the coin: exchange (with its logo, off CMC's exchange CDN), pair, price, ±2 % depth, 24 h volume, volume share, and a **deep link straight into that exchange's trade screen** — which is the entire point of the panel. Ranked by `cmc_rank_advanced`, CMC's liquidity-aware order, so deep trustworthy pairs lead rather than whichever venue self-reports the biggest number. Top 20 of (for BTC) 2,146 pairs, filterable All / CEX / DEX. Keyed by **`slug`**, not id — the one CMC endpoint that insists on it, so the call chains off the `detail` promise (which carries the slug) rather than launching with it; it still overlaps the chart fetch, so the request costs two round-trips, not three.

Rows CMC itself flags as **outliers** (`outlierDetected` / `priceExcluded`) are dropped — it excludes them from the coin's own headline price, so showing them would contradict the number in the page header. A `volumeExcluded` pair keeps its price but reports **`—`** for volume share, not `0 %`, which would read as "no trading".

**Stocks / ETFs / commodities → "Where to buy", deliberately NOT a markets table.** These assets have no market-pairs to tabulate: AAPL lists on exactly one venue (NasdaqGS), SPY on NYSEArca, WTI on NY Mercantile, and **every broker fills against the same consolidated quote**. No keyless source publishes per-broker price, depth or volume — so a table with those columns would be *invented*. What the panel shows instead is what's true: the **real listing venue** (from Yahoo's chart meta) plus links to brokers that carry the class. The broker list is **generic per class, not a per-symbol availability check**, and the panel says so in as many words — commodities point at futures brokers, since a cash-equity broker won't sell you a COMEX contract. The listing venue moved *out* of the stats grid and into this panel, where it answers a question rather than sitting as one more anonymous tile.

#### The one real CEX/DEX table a non-crypto asset gets (`app/api/market/asset/tokenized.ts`)

The ask was "add the CEX/DEX markets table to commodities/metals/stocks/ETFs too". Taken literally that is **unbuildable without fabricating data** — a crude-oil future does not trade on Binance, "CEX"/"DEX" are crypto-native venue types, and per the paragraph above Yahoo reports exactly *one* exchange per instrument. Every column of that table (price, ±2 % depth, 24 h volume, volume share) would have to be made up.

But there is a version of the request that is real: some of these assets have a **tokenized proxy** — an ERC-20 redeemable for the underlying, which genuinely trades on centralised *and* decentralised exchanges, and for which **CMC publishes a genuine market-pairs table**. So the same `MarketsTable` component renders, fed by the same `cryptoMarkets()` fetch (the token *is* a CMC-listed crypto asset — same endpoint, same outlier filtering, same liquidity ordering).

| Commodity | Token | Verified live |
|---|---|---|
| **Gold (XAU)** | **XAUt** (Tether Gold) — 1 token = 1 troy oz in a Swiss vault | 201 pairs, **both `cex` and `dex`** (Binance, OKX, Bybit… + a PAXG/XAUt pool on Uniswap v3) |

**Coverage is deliberately thin, and the map is allow-list only.** Gold is currently the only entry. Silver's Kinesis token (KAG) resolves on CMC but has **zero** market pairs, so silver is *absent* rather than present-with-an-empty-table — a token with no live pairs returns `null`, because an empty table would read as "no venues trade this". Tokenized US equities (the xStocks family) are not on CMC's keyless API at all, which is why the map is keyed by commodity symbol and no stock or ETF can have an entry. PAXG was the runner-up for gold and lost on liquidity (164 pairs, almost entirely CEX); **one token per commodity** keeps every row honestly attributable to a single named instrument.

⚠ **The table sits *below* Where-to-buy, never instead of it, and leads with a disclosure** (`.ad-token-note`, styled loud rather than as fine print). The rows are real prices — for a **different instrument** than the one charted at the top of the page, with its own issuer and counterparty risk. The futures contract and the token are two ways to get the same exposure, and a reader who skims the caveat and concludes they can reach the COMEX contract through Binance has been misled. Hence: both panels, and the disclosure names the token, its backing, and the fact that it is not the contract above.

⚠ `range=max` on Yahoo returns **monthly** bars whatever interval you ask for, so ALL requests `1mo` rather than pretending otherwise. 168 monthly bars covers Apple back to its 1984 listing.

### 16.3 · Explorer — multi-chain transaction search

The Wallet dashboard's fifth view (`ExplorerView.tsx`) and the only one added beyond Reach's set. Paste an **address** → a Blockscan-style result with a **Net Worth** header and **Portfolio | Transactions** tabs; paste a **tx hash** → that transaction's detail. Modeled on Blockscan / Suivision / Cardanoscan: a clean centered hero with one wide search bar and a row of **chain-family pills** (`All · EVM · Solana · SUI · Cardano · NEAR · Tron`) directly below it; picking `EVM` reveals a sub-row to choose the specific EVM chain (they share the `0x…40` address format). `All` auto-detects via `detectChain()` (`chains.ts`); a family pill overrides that. Once a result shows, the hero collapses to a compact top bar so the next search is one keystroke away.

**Address = Portfolio + Transactions.** The **Portfolio** tab (default) reuses `/api/wallet-tracker {action:'tokens'}` — the same endpoint (and `TokenIcon` fallback cascade) the Wallet Tracker's detail overlay uses — to render Net Worth + a holdings table (Token · Portfolio % · Price · Amount · Value), priced tokens first. For an **EVM** address (which exists on every EVM chain at the same 0x address) a **Token-Holdings breakdown** of per-chain cards sits above the table: the `tokens` lookup is fanned out across **all 23 EVM chains** (`EVM_CHAIN_IDS` — the original 7, plus Gnosis/Celo/Scroll/zkSync/Mode/Unichain/Zora, plus Linea/SEI/Sonic/Robinhood/World Chain/Ink/Soneium/Etherlink/LightLink) **in parallel** (`Promise.all`), each card showing that chain's USD subtotal + portfolio %, sorted by value (funded chains first). The grid collapses to the top 12 with a **Show N more / Hide chains** toggle (`BREAKDOWN_COLLAPSED`).

**An EVM chain's token source is a three-tier fallback** (`getTokens`, wallet-tracker route): (1) a keyless **Blockscout v2** host (`BLOCKSCOUT_HOSTS`) — preferred, carries per-token USD rates; (2) **Moralis** (`MORALIS_CHAINS`, needs `MORALIS_API_KEY`) for chains with no Blockscout — currently bsc, avalanche, SEI, Linea; (3) **the priced native coin only** (`getNativeOnlyTokens`) for a chain with neither. ⚠ Tier 3 exists because a chain with no source previously returned `{tokens: [], totalUsd: 0}` — a card reading "$0.00 / no tokens" for a genuinely funded wallet, indistinguishable from an empty one. **Sonic** is the only EVM chain on tier 3: it has a keyless RPC (`rpc.soniclabs.com`) and a CoinGecko id, but no token index anywhere — `explorer.soniclabs.com` serves the HTML explorer rather than a Blockscout API, and Moralis 400s it under every identifier (`sonic`, `0x92`, `146`). Its card prices native **S** and lists no ERC-20s. Its `cgId` is **`sonic-3`**, *not* `fantom` — the retired FTM id Sonic migrated from, which would misprice the chain exactly as the POL/`matic-network` trap did for Polygon. Before adding a chain, probe `https://<host>/api/v2/addresses/<addr>` **and** `/token-balances` and confirm a real `coin_balance` comes back: a host that only serves HTML returns 200 and silently yields $0.00 cards.

**Each card is a `<button>` that re-opens the same address on that chain.** An EVM address is valid on every EVM chain, so a click just calls `runSearch` with the chain forced (and moves the family pill / EVM sub-row to match); `ResultPanel`'s effects key off `result.chain`, so the Portfolio and Transactions tabs repopulate on their own. The active chain's card is marked (`.active`), so the grid doubles as the "where am I" indicator. It's a real `<button>` — not a click handler on a div — so it's keyboard-reachable and announced as clickable. Wall-time ≈ the slowest single chain (~2s), not the sum. The family pills also cover the four non-EVM single-chain networks the Wallet Tracker prices but that have no keyless tx list — **Injective, Hyperliquid, Hedera, Bittensor** — so e.g. an `inj1…` address resolves to a deep-link + a working Portfolio tab instead of "Unknown chain". Chains with no keyless price feed (Solana SPL, Sui, Cardano, NEAR non-native) return every token at `usdValue 0`; the native coin still prices, and the unpriced tail is capped at 50 rows (a whale can hold thousands) with a "N unpriced tokens hidden" note. The **Transactions** tab is the normalised tx timeline from `/api/explorer {action:'address'}`.

Both the single-chain holdings fetch and the multi-chain breakdown are seeded from `dataCache` (via `getExplorerResult`/`setExplorerResult`), so re-opening an address paints instantly. The holdings fetch is keyed `chain:query` — it *is* per-chain. ⚠ The **breakdown is keyed by address alone** (`breakdown:${query}`), deliberately **not** `chain:query`: the fan-out asks every EVM chain about the same address, so its result is identical whichever chain is being viewed. While the key included the chain, every chain-card click missed the cache and re-fanned all 22 chains for a payload already in hand — 23 requests per click instead of 1. Each has a 30s `AbortController` timeout so the spinner always resolves. ⚠ The fetch effects are keyed off the **address identity only, never off their own `loading`/`loaded` flags** — an earlier version listed `loading` in the deps, so `setLoading(true)` re-ran the effect whose cleanup aborted the in-flight request, stranding "Loading holdings…" forever.

**Data — keyless, reusing the same public providers as `/api/wallet-tracker`.** Every call goes through `/api/explorer` (public RPCs send no CORS headers; external calls belong server-side per CLAUDE.md). Each source is normalised into one `ExplorerTx` shape (`hash/timestamp/from/to/value/symbol/fee/status/method/direction`) so the UI is chain-agnostic:

| Chain family | Address history | Single tx |
|---|---|---|
| EVM (eth/arbitrum/base/polygon) | Blockscout `/api/v2/addresses/{a}/transactions` | `/api/v2/transactions/{hash}` |
| Solana | RPC `getSignaturesForAddress` | `getTransaction` |
| SUI | RPC `suix_queryTransactionBlocks` (FromAddress) | `sui_getTransactionBlock` |
| Cardano | Koios `/address_txs` | `/tx_info` |
| NEAR | nearblocks `/v1/account/{a}/txns` | `/v1/txns/{hash}` |
| bsc / avalanche / optimism / tron | — (deep-link only) | — (deep-link only) |

**Graceful degradation, not errors.** Chains with no keyless tx list (bsc/avalanche/optimism/tron), or any upstream failure, return `{deepLinkOnly:true, deepLink}` and the UI shows a "View on {explorer}" link built by swapping the address path for the tx path (`txUrl`, the same technique as the wallet's `tokenExplorerUrl`). Upstream error text is never surfaced (it can carry internal URLs) — a failure degrades to an empty result + deep-link. Addresses **and** hashes are validated per family before interpolation into any upstream URL. No API keys; no new external hosts beyond those `/api/wallet-tracker` already uses. Token-transfer enumeration inside a tx is out of scope for v1 (native value + method + deep-link cover it).

**Why the pure-function split.** `normalize.ts` (server) and `explorerDetect.ts` (client) hold the normalizers / classifier / URL builders as `next/server`-free, sibling-import-free functions so their `.mjs` logic tests run under plain `node` — the same reasoning that split `hosts.ts` out of the wallet-tracker `route.ts`. (`tsconfig` sets `allowImportingTsExtensions` so `explorerDetect.ts` can import `./chains.ts` with the extension node needs.)

### Hardening added on the way out of Electron

A local desktop app can trust its own input; a public web route cannot. The routes add what Reach had no need for:

- **Input validation** — symbols must match `/^[A-Z0-9]{1,10}$/` and addresses are regex-checked per chain (EVM / Solana / Tron / NEAR) *before* being interpolated into an upstream URL. A traversal-shaped symbol or address is rejected (400), never proxied.
- **Caching** — prices 20 s, movers 60 s, CoinGecko 60 s. The client polls every 30–60 s and several tabs may poll at once; uncached this would fan out per-symbol and invite a rate-limit. A total upstream wipeout is *not* cached, so a transient failure can't stick.
- **Error opacity** — upstream error text is never forwarded (it can carry internal URLs); failures degrade to a null quote / empty list.
- **Bounded responses** — see the token cap below.

### Files

| File | Role |
|---|---|
| `web/app/home/wallet/page.tsx` | Server component; renders `<WalletShell/>`. |
| `web/app/home/wallet/WalletShell.tsx` | `'use client'` — owns the active view **and the selected asset**; code-splits Movers/Tracker/Explorer/AssetDetail. Tracker and Explorer are mounted lazily on first visit then kept mounted (`display:none`) so a switch keeps their state. Hides the board with `display:none` while a detail page is open so **Back** restores its page, sort and polled data (§16.1). |
| `web/app/home/wallet/AssetDetailView.tsx` | `'use client'` — the asset detail page every leaderboard row opens into: header quote, inline-SVG price chart (24H/7D/1M/1Y/ALL), data-driven stats grid, links, **description (all four classes)**, and the markets panel — a real CEX/DEX table for crypto and for a tokenized commodity proxy, or the Where-to-buy broker panel otherwise (§16.1–16.2). |
| `web/app/api/market/asset/descriptions.ts` | The About copy, one source per class — Nasdaq profile (stocks, live), pinned Wikipedia articles (16 commodities), a hand-written map (40 ETFs). Enforces *"about this exact asset, or absent"*; a miss returns `''`. Also owns `nasdaqTicker()` (the `BRK.B` dot form). (§16.1) |
| `web/app/api/market/asset/tokenized.ts` | Allow-list of commodities with a tokenized proxy that has **live** CMC market pairs — gold → XAUt today. The only way a non-crypto asset gets a real CEX/DEX table. (§16.2) |
| `web/app/home/wallet/Sidebar.tsx` | `'use client'` — Add Asset button, 5-item nav (Wallet · Wallet Tracker · Explorer · Leaderboards · Gainers & Losers), live clock; resizable + collapsible via `useSidebarResize` (§15). |
| `web/app/home/wallet/WalletView.tsx` | `'use client'` — CoinMarketCap-style Portfolio (content only; the app shell supplies top/bottom bars). Header: portfolio-name `▾` switcher (switch/create/rename/delete via `PortfolioSwitcher`), `$total` + hide-value eye + `+`, and 24h/All-time change lines. A chip row — **Holdings / All-time profit / Allocation** — swaps the whole panel below AND the asset table's third column: Holdings → value area chart + value column; All-time profit → dual-line chart (blue portfolio-profit-% + orange BTC-trend-% from `/api/market/klines`) + per-asset profit column; Allocation → donut + allocation-% column with per-row bars. Timeframe pills (24h/7d/30d/90d/All) show on Holdings + All-time profit, not Allocation. The third-column header sorts rows by that column (desc default). `+ New transaction` opens the Add Asset modal. An **Overview / Transactions** tab strip sits under the header: Overview is the chip UI above; Transactions derives one **Buy** row per holding from its `purchased_at` + `amount` + `amount×avg_buy_price`, grouped by day (newest first), with a floating `+` FAB — no separate transaction store (a full buy/sell log would need one). The value/profit charts trim history before the last **>20% snapshot-to-snapshot jump**: snapshots record the portfolio *total*, so adding/removing a holding (or switching portfolios) makes `recordSnapshot()` write a far-off total that would otherwise draw a vertical spike splicing two different portfolios — the chart shows only the current portfolio's run. Timeframe pills render full-width in a rounded track (`.wallet-period-row`). |
| `web/app/home/wallet/AddAssetModal.tsx` | `'use client'` — 4 category tabs, search, asset grid, amount / avg-buy-price. |
| `web/app/home/wallet/MoversView.tsx` | `'use client'` — the 8-tab market page (see below). |
| `web/app/home/wallet/CoinIcon.tsx` | `'use client'` — CMC coin logo (crypto rows carry a `thumb` URL), falls back to a coloured initial on 404. |
| `web/app/home/wallet/MarketIcon.tsx` | `'use client'` — leaderboard avatar for the **non-crypto** classes (stocks / ETFs / commodities), which arrive from `/api/market/screener` with no logo URL. Walks the `iconChain()` fallback list, degrading to a coloured initial only if every step errors. |
| `web/app/home/wallet/marketIcons.ts` | Icon resolution for those three classes: the stock/ETF logo CDNs, base-ticker normalisation, and the 16 inline-SVG commodity discs. See below. |
| `web/app/home/wallet/movers.logic.test.mjs` | Node test for the market page's derivations (sort, sentiment, pool, formatters). |
| `web/app/home/wallet/WalletTrackerView.tsx` | `'use client'` — address form, wallet cards, token-detail overlay. |
| `web/app/home/wallet/ExplorerView.tsx` | `'use client'` — the multi-chain transaction Explorer (§16.3). Blockscan-style centered hero (one wide search bar + `All/EVM/Solana/SUI/Cardano/NEAR/Tron` family pills, an EVM sub-row to pick the specific EVM chain) that collapses to a compact top bar once a result shows. Renders a tx timeline (in/out arrows, method chip, counterparty, value, relative time) for an address and a field grid for a single tx. Calls `/api/explorer`; seeds from `dataCache`. |
| `web/app/home/wallet/explorerDetect.ts` (+ `explorerDetect.logic.test.mjs`) | Pure `resolveChain()` (family pill overrides `detectChain()`), `classify()` (hash-vs-address), and `txUrlClient()` (address-path→tx-path swap per explorer), split out so the `.mjs` test runs under plain `node`. |
| `web/app/api/explorer/chains.server.ts` | Per-chain tx-source table (Blockscout host / RPC / explorer base, decimals, native, `isDeepLinkOnly()`, `CHAIN_FAMILIES`) — the `next/server`-free config the route + normalizer share. |
| `web/app/api/explorer/normalize.ts` (+ `normalize.logic.test.mjs`) | Import-free normalizers turning each upstream (Blockscout / Solana / Sui / Cardano / NEAR) into one `ExplorerTx` shape (`fromUnits`, `directionFor`, status/timestamp mapping), plus `txUrl`/`validHash`/`isTxHash`. Kept sibling-import-free so the `.mjs` test resolves it under plain `node`. |
| `web/app/home/wallet/dataCache.ts` | Session-scoped, in-memory last-value cache (a module var, NOT localStorage) for fetched market data — tracker prices/balances, holdings quotes, and the Movers CMC/screener blobs. Views seed initial state from it so a revisit paints the previous data instantly instead of an empty "Loading…" table; the normal fetch effect then refreshes and writes back. Never gates a fetch (a stale entry only removes the empty flash) and holds only already-public data. See the performance notes in §16. |
| `web/app/home/wallet/assets.ts` | Asset catalog (~200 crypto / 50 stocks / 4 metals / 10 currencies) + logo/colour/glyph resolution + shared formatters. |
| `web/public/metals/*.gif` | Reach's animated metal coin sprites (gold / silver / platinum / palladium), 32×32. |
| `web/app/home/wallet/holdings.ts` | `ov_holdings` + `ov_portfolio_snapshots` persistence. |
| `web/app/home/wallet/chains.ts` | 16-chain config, `detectChain()`, `poolMap()` (bounded-concurrency fetch), `filterByChain()` / `chainCounts()`, the 231 seeded `DEFAULT_WALLETS`, `ov_tracked_wallets` persistence + `SEED_VERSION` migration. |
| `web/app/home/wallet/chainIcons.ts` | Inline-SVG artwork for all 32 chains as data-URIs (official web3icons geometry for the newer marks; Solana's is the real gradient logo) — no network, no CDN (see §16 notes). Gradient-based marks (SEI, Etherlink, LightLink, Zora) carry their own `<defs>`, with ids namespaced per chain so two marks can't collide in one document. |
| `web/app/api/wallet-tracker/polkadot.ts` | Bittensor (TAO) balance over Substrate WS via `@polkadot/api` — a lazily-imported singleton connection, isolated here so no other chain pays the dependency's cost (see §16 notes). |
| `web/app/home/wallet/ChainIcon.tsx` | `'use client'` — renders a chain's SVG mark, degrading to the coloured letter badge for any chain without artwork. |
| `web/app/home/wallet/AssetIcon.tsx` / `icons.tsx` | Asset avatar w/ fallback chain; inlined Lucide glyphs. |

**One dependency, for one chain.** As in the Journal, both charts are hand-rolled inline SVG and the Lucide glyphs are inlined as SVG paths — the only npm dependency the wallet tracker pulls in is `@polkadot/api`, unavoidable for Bittensor's Substrate WS balance query (see the §16 note), and lazily imported so it loads only when a TAO lookup actually runs.

**Metal logos.** The four metals use Reach's animated coin sprites, copied from its `src/assets` into `web/public/metals/` (32×32 GIFs, ~7KB total). Reach's own mapping is *not* the obvious one — its `XAG` points at `Platinum_Coin.gif` and its `XPT` at `Crystal_Coin.gif`, because the Tibia platinum coin reads as silver and the crystal coin as platinum. That indirection is resolved **at the filename** on copy (`gold/silver/platinum/palladium.gif`), so `METAL_LOGOS` stays literal. Reach's `metalSvg()` data-URI coins are retained as `METAL_SVGS` and serve as the `onError` fallback, so a missing sprite degrades to a drawn coin rather than a blank chip. The GIFs render with `object-fit: contain` and `image-rendering: pixelated` (`.wallet-icon-img-metal`) — `cover` would crop the round coin's edges and smoothing would blur the pixel art at 28–40px.

Reach also appends a `?t=${Date.now()}` cache-buster so every GIF instance starts its animation on the same frame; that is **deliberately not ported** — at module scope in Next.js it differs between server and client, which hydration-mismatches the `src` attribute, and it defeats HTTP caching. The coins simply animate out of phase.

### Notable behaviours

- **History chart** needs a time series. Reach keeps snapshots in SQLite; with no server DB they go to `localStorage` on each price poll. The chart therefore shows Reach's own **"Collecting data"** empty state until two snapshots exist — expected on first load, not a bug.
- **Token cap.** Blockscout's `token-balances` is unbounded: a long-lived address (Vitalik's) returns **~3 MB / 6.6k tokens in ~6 s**, mostly worthless airdrop spam. Two consequences, both handled: the fetch needs a **25 s** timeout (the default 8 s silently clipped it and yielded an empty list — a real bug caught in testing), and the response is **sorted by value and capped at 100**. The `totalUsd` is summed over *all* tokens before the cap, and the UI states "Showing the 100 most valuable of N" — a truncated list must never read as complete.
- **Solana/Tron/NEAR non-native token USD values are 0** — no per-token rate feed exists on those paths (Reach has the same gap). The UI omits the value (renders `—`, gated on `price > 0`) rather than printing a misleading `$0.00`. The **native** coin on each of those chains *is* priced (off the CoinGecko quote), so it carries the wallet's Total Value.
- **Six chains beyond Reach's ten — native-balance-only.** `hyperliquid` (HYPE), `cardano` (ADA), `sui` (SUI), `bittensor` (TAO), `injective` (INJ) and `hedera` (HBAR) were added. Each has a keyless native-balance lookup in `getBalance` (Hyperliquid `info` API, Koios, Sui fullnode RPC, Injective LCD, Hedera Mirror Node REST, and — for Bittensor — a Substrate WS query; see the `@polkadot/api` note below) but **no keyless multi-asset index** comparable to Blockscout/Moralis, so their detail view is the priced native-coin row only (`getNativeOnlyTokens`), the same shape Solana/Tron use for their unpriced tokens but going further — no secondary tokens are listed at all. Two footguns are commented loudly in `route.ts`: Hyperliquid's `.total` is *already* a human-readable decimal (its `cfg.decimals` is `0` and `fromUnits` is never applied), and Hyperliquid uses EVM-format `0x`+40hex addresses but is **not** an EVM RPC chain (its own `ChainType`). Auto-detect (`detectChain`) resolves Sui/Cardano/Injective/Bittensor/Hedera by their distinct formats; Hyperliquid collides with Ethereum's `0x`+40hex and so is picked from the dropdown, not auto-detected.
  - **`@polkadot/api` — the wallet tracker's first real npm dependency.** Bittensor has no keyless HTTP balance endpoint in 2026 (Taostats/Subscan both require a key); the only free option is `wss://entrypoint-finney.opentensor.ai:443`, a Substrate WebSocket JSON-RPC node whose `system.account` storage is SCALE-encoded. `@polkadot/api` is the canonical decoder. It's isolated in `app/api/wallet-tracker/polkadot.ts` and only `await import(...)`-ed inside the `bittensor` branch, so no other chain's request loads it (it's a large package). The `ApiPromise` is a **singleton** — one WS connection opened lazily and reused across requests; the connect promise is assigned synchronously before its first `await` so concurrent first-callers share it rather than racing two connects, and a `disconnected` event clears the singleton so the next lookup reconnects. On serverless the module can cold-start, re-opening the socket once per fresh instance — acceptable, far better than per-call. `getTaoBalance` has its own 8s connect timeout and degrades to `0` on any failure, so a hung WS lookup can't hold a refresh-pool slot open or blank the panel.
- **Whale defaults seeded — 231 wallets.** The tracker no longer ships Reach's 20 Ethereum-heavy addresses; `DEFAULT_WALLETS` covers **the original 10 chains** with roughly its 20 largest publicly-identified wallets each, plus live-verified seeds on the newer chains: **15 Sui** whales, **15 Cardano** whales, **15 Hedera** accounts (treasury/fee + council consensus nodes), **11 Injective** module + validator accounts, and **2 Hyperliquid** protocol addresses. Where a chain has no keyless entity-label source, the top holders are seeded as unlabelled "Whale N" — the address and balance are real, only the name is unknown. **Bittensor ships with no seeds**: its holders' TAO is bonded to subnets, so the liquid `system.account.free` balance the tracker reads is ~0, and every seed would render `$0.00` — which the seed policy forbids. The seed policy still forbids inventing addresses; every entry above returned a non-zero native balance on live verification. Users can still paste any address on every chain. Restorable any time via **"Load Known Wallets"** (which keeps user-added addresses). Seeding happens only when `ov_tracked_wallets` has *never* been written — unlike Reach, which re-seeds whenever the stored array is empty and therefore makes an empty tracker unreachable.
  - **Every address was verified against `/api/wallet-tracker` before being committed**: it must pass that chain's address validator *and* return a non-zero native balance. This bar is not optional — a wrong address **fails silently**, rendering a normal-looking card that reads `$0.00` rather than an error (exactly the failure mode of Reach's bogus Tron address). ~10 researched candidates were dropped for returning zero.
  - Chains below 20 (Polygon 16, Solana 13, Tron 19, Avalanche 14, NEAR 11) have **fewer than 20 addresses that are both publicly identified and hold a meaningful native balance**. Padding them would have meant inventing addresses, so they ship short.
- **Balance fetches are pooled, not fired all at once.** 173 wallets × a refresh every 60 s would mean 173 concurrent requests through the route to keyless public RPCs — enough to get rate-limited (and Tron is *already* serialised server-side at ~1.1 s/call). `poolMap()` in `chains.ts` caps in-flight balance lookups at `BALANCE_CONCURRENCY = 6`, and results are merged into state **as each lands** rather than in one batch, so cards fill in progressively instead of the whole list waiting on the slowest chain.
- **Chain filter.** A row of pills above the list (All Chains + one per chain that has wallets, each with its icon and a count) filters the rendered wallets. It is deliberately **separate from the add-form's chain dropdown**: that dropdown picks the network a *newly added* address belongs to and auto-detects from what's typed, so wiring the two together would mean pasting a `0x…` address silently changed which chain you were looking at. Only the list is filtered — the headline total and the chain pills stay whole-portfolio, since a filtered total that drops reads as "my money vanished" rather than "I'm viewing a subset". A pill only appears for a chain that has wallets, and if the selected chain's last wallet is removed the filter falls back to All rather than stranding the user on an empty list. Logic lives in `filterByChain()` / `chainCounts()` (`chains.ts`), unit-tested in `walletFilter.logic.test.mjs`.
- **Tab/route switching is instant and never re-fetches (dashboard performance).** Four changes, all behaviour-preserving:
  - **Wallet sub-tabs stay mounted.** `WalletShell` used to render `{view === 'wallet' && <WalletView/>}` / `{view === 'tracker' && <WalletTrackerView/>}`, so every Wallet↔Tracker switch *unmounted* the other view — throwing away its fetched prices/balances and its filter/scroll/panel state, then re-fetching from scratch (the tracker re-ran its whole 173-wallet pass on every switch). Now both are kept mounted and the inactive one is hidden with `display:none` (the tracker is mounted lazily on first visit, then kept). Measured: switching back to the tracker went from a full reload to ~50ms with balances already on screen.
  - **Tracker chunk is pre-warmed.** `WalletTrackerView` is still `next/dynamic` code-split (not needed for the wallet's first paint), but `WalletShell` now warms its chunk on `requestIdleCallback` after the wallet paints, so the *first* switch doesn't wait on a chunk download.
  - **Session data cache (`dataCache.ts`).** Even a hard folder-tab route change (Wallet↔Assets via `next/link`) keeps the same JS module instance, so a module-level last-value cache survives it. `WalletView` (holdings quotes), `WalletTrackerView` (native prices + balances) and `MoversView` (the CMC + screener response blobs) each seed their initial state from this cache and write fresh results back — so a revisit paints the previous data immediately instead of an empty table, while the normal fetch refreshes in the background. The cache never gates a fetch and holds only public market data. (A *full page reload* still starts cold — a module var is per-page-load, by design.)
  - **Balance updates are coalesced.** The tracker's pool used to call `setBalances` once per wallet — up to 173 sequential state updates per pass, each re-rendering the whole list and recomputing the (then-unmemoised) total, i.e. O(N²) work. Landed balances are now buffered in a ref and flushed to state at most every 400ms (plus a final flush), so a pass is a handful of renders while cards still stream in visibly; `totalUsd` and `usdOf` are memoised so typing in the add-form no longer re-totals every wallet.
- **Fetch order interleaves chains (unfiltered) / follows the filter (filtered).** A full pass is ~100s. The seed list is grouped by chain (ethereum … near), so a straight pass on first load reached the **last** group (NEAR) only after ~90s — every NEAR wallet showed `0.00000000 NEAR / $0.00` for a minute, indistinguishable from broken data (a real bug caught in the browser). With no filter, `fetchOrder` now **round-robins across chains** so each chain gets its first balances early and none is starved at the tail (same set, interleaved order). With a chain filter active, the visible wallets are fetched first, the rest after. Either way every wallet is still fetched, so the total stays whole. Caveat: `fetchAll`'s in-flight guard drops a re-prioritisation if a pass is already running, so switching filters *mid-pass* doesn't jump the queue. That's deliberate — cancelling and restarting on every filter click would re-request everything already fetched and hammer the same rate-limited endpoints the guard exists to protect.
- **Seed migration (`SEED_VERSION`).** The seed set changed from Reach's 20 to 173, and `loadTracked()` only ever seeded when the key had *never* been written — so an existing user would have been stuck on the old 20 forever. `loadTracked()` now compares a stored `ov_tracked_seed_version` against `SEED_VERSION` and, when stale, swaps the old seeds for the current set. It is careful with user data: rows the user added themselves (identified by *not* having a `default-N` id) are preserved verbatim, and a deliberately-emptied tracker **stays empty** rather than having 173 wallets reappear underneath it. `loadTracked()` is a **pure read** — it must not stamp the version, because React StrictMode double-invokes the mount effect and an earlier version that wrote during the read had its second call skip the migration and hand back the stale list it had just replaced (caught in the browser, pinned in `seedMigration.logic.test.mjs`). `saveTracked()` owns the stamp.
- **Right-click a wallet card → View / Rename / Delete** (`.wt-ctx-menu`, anchored to the cursor via `onContextMenu`). **View** opens the same token-detail overlay a left-click does (`openDetail`); **Delete** is the existing `handleRemove`; **Rename** opens a small dialog (`.wt-edit-panel`, reuses `.wt-detail-overlay`) to change the wallet's display **name** (`label`) only — the address and chain are immutable (remove and re-add to track a different address), which sidesteps address-validation and collision concerns. The label persists through the normal `saveTracked()` path. The menu closes on outside click, scroll (it's cursor-anchored, so scrolling would strand it) or Escape. **The outside-click close excludes the menu by ref (`ctxRef`), not by `stopPropagation`** — a React synthetic `stopPropagation` does not reliably stop the document-level native `mousedown` listener, which was closing the menu before an item's `onClick` (mouseup) could land, so every item appeared dead.
- **Adding a wallet takes an optional name.** The add-form has a `.wt-name-input` ("Name (optional)") left of the address box; `handleAdd` trims it into `label` (omitted when blank) on the new `TrackedWallet`. On mobile both inputs go full-width and stack (name order 2, address order 3).
- **Chain icons are inline SVG** (`chainIcons.ts` → `ChainIcon.tsx`), not remote logos — same rule the commodity artwork follows (§ leaderboard icons): a chain logo is *identity*, and a wrong-but-confident one mislabels which network a balance is on. Data-URIs mean no network, no CDN dependency, and nothing to mismatch; a chain with no artwork degrades to the coloured letter badge it replaced. **All 31 chains in `CHAINS` now have artwork** (verified: no id in `CHAINS` is missing from `CHAIN_ART`), so the letter badge is a safety net for a future chain rather than a state any chain ships in — the 14 EVM chains from the two widenings rendered as letters until their marks were added. Used on the wallet cards, the chain dropdown, the summary pills, and the detail panel.
- **Non-Ethereum wallet token detail showed nothing** — clicking a wallet on any chain but Ethereum opened an empty detail panel. `getTokens` looks the EVM chain up in `BLOCKSCOUT_HOSTS` and, with no host, returned an empty token list *with no error* — so polygon/optimism/bsc/avalanche all rendered nothing. Fixed in two parts:
  - `polygon.blockscout.com` and `explorer.optimism.io` are live and return priced `token-balances`, so both were added to `BLOCKSCOUT_HOSTS`.
  - **bsc and avalanche have no healthy public Blockscout instance and no keyless token API** (Ankr, Etherscan V2, 1inch, OKLink, bscscan-V1 all now require a key or reject the chain). They fall back to **Moralis** (`getEvmTokensMoralis`), whose `/wallets/{addr}/tokens?exclude_spam=true&limit=100` returns balances *and* USD prices in one call, keyed by `MORALIS_CHAINS`. Requires `MORALIS_API_KEY` (free tier, **Data API → Read** scope, server-side only, in `.env.local`; template in `.env.example`); when the key is **absent** those two chains degrade to balance-only exactly as before — no crash. Every other EVM chain still uses Blockscout. Two Moralis quirks handled: (1) a wallet with **>10k tokens** (Binance's BSC hot wallet) is rejected upstream on every endpoint — detected via the response message and surfaced as `tooMany: true`, which the detail panel renders as "too many tokens to list" rather than blanking or erroring; (2) `possible_spam` misses some impersonator tokens (a fake "USDT" with a 1e39 balance that poisons the total), so non-native tokens are additionally filtered to `verified_contract === true`.
  - **Free-tier quota (40k compute units/day) is protected by a cache.** Each bsc/avalanche wallet-detail click is one Moralis call, so `getEvmTokensMoralis` caches the result per `chain:address` for **5 min** (`moralisCache`, bounded at 500 entries, oldest evicted first). Re-opening the same wallet inside the window costs **0 CU** (measured: 9.5s cold → 23ms warm, identical payload) — normal browsing stays comfortably inside the free tier without paying. A 429 for the rest of a day still degrades those two chains to balance-only, no crash.
  - Config (`BLOCKSCOUT_HOSTS`, `MORALIS_CHAINS`) moved to `app/api/wallet-tracker/hosts.ts` so it's unit-tested under plain `node` (`route.logic.test.mjs` asserts every EVM chain resolves *some* token source), same pattern as the stocks screener.
- **Token rows link to the chain explorer.** Each row in the wallet detail is an `<a>` (opens a new tab) to that token's explorer page — the per-contract `/token/{address}` page for ERC-20s, and the wallet's `/address/` page for the native coin (which has no contract). The per-explorer token path is derived from `chain.explorer` by `tokenExplorerUrl()` in `chains.ts` (EVM etherscan-family `/address/`→`/token/`, Solana `/account/`→`/token/`, Tron `/#/address/`→`/#/token20/`), unit-tested in `tokenExplorer.logic.test.mjs`. The row keeps its grid layout with a link reset + hover tint (`.wt-token-row` in `globals.css`).
- **Native-coin row icon uses the chain's own SVG mark.** The balance source returns no `logo` for the native token, so the row used to fall back to a bare letter ("E" for ETH). It now renders `getChainArt(chain.id)` — the same inline data-URI mark shown on the wallet cards and pills — so ETH/BNB/POL/AVAX/SOL/TRX/NEAR show their real network icon.
- **Logo-less ERC-20s get a real-logo attempt, then a per-chain badge.** The `TokenIcon` component (in `WalletTrackerView.tsx`) drives a fallback cascade per token: (1) the balance source's own `logo`; (2) for the native coin, the chain SVG mark; (3) a **best-effort real logo from Trust Wallet's asset repo** by contract (`trustWalletLogoUrl` in `chains.ts`) — keyless, but its raw.githubusercontent path is *case-sensitive*, so it's only offered for the Blockscout chains (whose token addresses come back EIP-55 checksummed); Moralis chains return lowercase and skip it (would 404) rather than pulling in a keccak dep; (4) a **generic chain-tinted badge** (`genericTokenArt` in `chainIcons.ts`) — a disc in the chain's brand colour with the token's initial (dark text on BNB's yellow, white elsewhere), so a placeholder reads as "a token on chain X", is distinct per token, and is deliberately *not* the chain's own coin logo. Steps 1 & 3 are remote images; `onError` walks to the next source, and the generic badge is a data-URI that always renders — a broken/hotlink-blocked logo never leaves an empty circle. Covered by `tokenIcon.logic.test.mjs`. (The old `.wt-token-avatar` letter fallback is now unused — every icon is an `<img>`.)
- **Polygon was silently priced at `$0.00`** — a pre-existing bug found while verifying the seed list. CoinGecko retired the `matic-network` id in the MATIC→POL migration and now answers it with an *empty object*, so every Polygon wallet rendered a real native balance next to a `$0.00` value. Fixed to `polygon-ecosystem-token` in **both** `route.ts` (`CHAINS[].cgId`) and `chains.ts` (`Chain.cgId`) — the two must agree, since the client looks the price up under the id the route asked for.
- **NEAR balances all read `0` — the RPC had been deprecated.** `rpc.mainnet.near.org` now returns **HTTP 429 + `"THIS ENDPOINT IS DEPRECATED! STOP USING IT NOW!"`** on every call, so `getBalance`/`getTokens` for NEAR degraded to `{ balance: 0, error: 'Lookup failed' }` and every NEAR wallet rendered `0.00000000 NEAR / $0.00`. Switched `CHAINS.near.rpc` to **`https://free.rpc.fastnear.com`** — the keyless provider NEAR's own deprecation notice points to — which serves both `view_account` (balances) and `call_function` (`ft_metadata`, used by the token detail).
- **NEAR token detail: native NEAR + NEP-141 fungible tokens.** NEAR has no single "list an account's tokens" RPC, so `getNearTokens` (`route.ts`) builds the detail from two sources: the **native NEAR** balance (priced off CoinGecko — this row carries Total Value), plus **NEP-141** fungible tokens whose contract list comes from **FastNEAR's keyless FT index** (`api.fastnear.com/v1/account/{id}/ft`). Each FT's symbol/name/decimals/icon then come from its own `ft_metadata` view call (decoded from the byte-array return by `parseFtMetadata` in `hosts.ts`, unit-tested in `route.logic.test.mjs`). The metadata fan-out is capped at `NEAR_TOKEN_LIMIT = 50` non-zero holdings (a spammy account lists hundreds of dust contracts). NEP-141 tokens carry **no USD price** (no rate feed, same as Solana SPL / Tron TRC-20) — balance only, value omitted. Remote FT icon URLs are dropped (only inline `data:` icons kept, since `next/image` can't allowlist arbitrary hosts); the client falls back to generated art. If FastNEAR is down the panel degrades to the native row alone rather than failing. Many seeded NEAR wallets are staking pools whose only FTs are reward-spam tokens ("Claim reward at …"); that's the data, not a bug.

### Reach's endpoint config had rotted — rebuilt

Reach was written against keyless endpoints that have since started demanding auth or 404'ing. Ported verbatim, three of the 20 seeded wallets could never load. Found by testing all 20 against the live chains rather than trusting the port:

| Broken (Reach) | Symptom | Fix |
|---|---|---|
| `rpc.ankr.com/eth` (ETH fallback) | `Unauthorized: You must authenticate` | **All 7 EVM RPCs → `publicnode.com`** (keyless, verified on every chain) |
| `polygon-rpc.com` | `API key disabled, tenant disabled` | ↑ same — Polygon had *no* working path, since its Blockscout host 500s too |
| `bsc` / `avalanche` `.blockscout.com` | 404 / 404 | No healthy public Blockscout. Balance via RPC; **token detail via Moralis** (`MORALIS_API_KEY`), or balance-only if the key is unset. |
| TronGrid, called in parallel | `allowed_rps(1)` — suspends the caller | **Serialised behind a promise chain** (`tronFetch`, ~1.1 s gap). 20 wallets refreshing at once otherwise trip it. |
| `rpc.mainnet.near.org` | **HTTP 429 + "ENDPOINT IS DEPRECATED! STOP USING IT NOW!"** on every call — surfaced later, not at port time | **NEAR RPC → `free.rpc.fastnear.com`** (keyless; the provider NEAR's own notice points to). Serves `view_account` + `call_function`. |
| `TLyqzVGLV1srkB7dToTAEQgDSFPg9BB3in` ("Justin Sun", Tron) | `A valid account address is required` — fails base58 checksum, invalid even in isolation | Replaced with Binance's Tron cold wallet (`TWd4Wr…`, ~2.01 B TRX) |
- **Not ported:** Reach's drag-to-reorder stat cards / swap-charts gestures.

### The market page (`MoversView`) — Leaderboards + a 5-tab market row

All crypto, all off CoinMarketCap. Two of Reach's original tabs are gone and one has moved:

- **Leaderboards** is a **left-sidebar destination**, not a tab — it renders standalone, without the
  tab row, and covers all four asset classes (see below).
- **Metals** and **Stocks & ETFs** were **removed**, and the `/api/market/movers` route that fed them
  was **deleted** with them. They were our own additions (Reach had no equivalent) and covered a
  hand-picked handful of symbols — 4 metals and 12 stocks + 4 ETFs. The Leaderboards' Stocks / ETFs /
  Commodities boards supersede them outright (500 stocks, 40 ETFs, 15 commodities including all four
  of those metals), so keeping both would have meant two competing answers to the same question. It
  also retired that route's hand-maintained SEC share counts, which needed re-checking a couple of
  times a year.

The remaining five make up the market tab row (`MARKET_TABS`):

| View | Source | Derivation |
|---|---|---|
| **Leaderboards** *(sidebar, not a tab)* | `/api/market/cmc` `coins` (Crypto) · `/api/market/screener` (Stocks / ETFs / Commodities) | Four asset-class sub-tabs. **Paginated 100 a page** (Crypto and Stocks run to 500 rows = 5 pages; ETFs 40 and Commodities 16 fit one page, so the paginator hides itself). Crypto is ordered by **`cmcRank`, not raw market cap** — CMC omits stablecoins / wrapped assets / LP tokens from its ranking, so e.g. USDY carries a top-100 cap but a rank of 200+; ordering by cap dragged those onto page 1 while the `#` column still printed their real rank. Column sorts are **per-page**: the page is sliced first, then sorted, so a sort never pulls a row in from another page. The `#` column is sortable and prints the row's board rank (never a 1..100 row counter, which would misreport rank under a sort) |
| Gainers & Losers | ↑ same list | filtered to `volume > 50k`, capped by the pool dropdown (Top 100 / Top 500 / All), split on the timeframe's change field (1h / 24h / 7d / 30d) |
| Trending · Most Visited · Recently Added | CMC `spotlight` | rendered as returned |
| Community Sentiment | ↑ `coins` + Fear & Greed | Most Bullish / Most Bearish = top 15 by `volume × change24h` (a **momentum** score — a big move on real volume outranks a bigger move on none). Per-row bar = `clamp(50 + change24h × 2, 0, 100)`, a per-coin reading, *not* a share of the list |

**The Leaderboards screener (`/api/market/screener`).** The crypto board gets 500 ranked coins from a
single CMC call; this route is the equivalent for the other three classes, and each needed a different
answer because **no one keyless provider ranks all three**:

| Class | Source | Why |
|---|---|---|
| Stocks (500) | Nasdaq's own screener, `api.nasdaq.com/api/screener/stocks?...&country=united_states` | One request returns 500 rows **already sorted by market cap**, keyless — the only bulk source found that does. Needs a browser `User-Agent` or it rejects the call. Yahoo's `v7/finance/quote` is dead for this (`Invalid Crumb`), and Yahoo's screener paginates incorrectly (`offset` is ignored; `start` returns a jumbled set). **Carries no volume field**, so the Volume column is a dash for stocks — that's upstream, not a bug. |
| ETFs (40) | curated list → Yahoo `v8/finance/chart` per symbol (+ `quoteSummary` for AUM) | No keyless source *ranks* ETFs by AUM: Nasdaq's ETF screener has **no AUM, cap or volume field at all** and no working sort (it comes back alphabetical). AUM rankings barely move week to week, so the universe is hardcoded and ranked by **volume** instead. Yahoo, unlike Nasdaq, does report volume. |
| Commodities (16) | Yahoo `v8/finance/chart` per symbol (+ `quoteSummary` for open interest) | No commodity screener exists on either provider. Only ~16 symbols, so per-symbol fetching is cheap. Ranked by volume. Names are hardcoded: the contract's own `shortName` reads "Gold Aug 26", and `CT=F` (cotton) returns none at all. |

Both upstreams are undocumented and can change without notice (Yahoo already locked down
`v7/finance/quote`), so every source fails soft — an empty list, never a throw — and the payload is
cached 60s so the client's 30s poll doesn't hammer them. The screener is fetched **only while the
Leaderboards tab is open**, in its own effect, so the other seven tabs don't pay for it.

**Cleaning Nasdaq's stock rows (`screener/stocks.ts`).** Nasdaq's screener returns *every listed
security*, named the way a prospectus would name it — which surfaced as two kinds of apparent
duplicate on the board. Both are fixed in `stocks.ts`, a Next-free module so the rules are unit-
testable under plain `node` (`route.logic.test.mjs`):

| Rule | Problem it fixes |
|---|---|
| `isCommonEquity(name)` — drops preferred stock, notes, warrants, rights, debentures | These are **stamped with the issuer's market cap**, so they ranked as a second copy of the company: `GOOGM`/`GOOGN` (Alphabet preferred depositary shares) sat in the top 25 at Alphabet's ~$600B, alongside `TBB` (AT&T notes), `BRKRP`, and the whole `AGNC*`/`HBAN*`/`STR*` preferred series. **24 of 500 rows.** Deliberately narrow — it matches the *instrument* wording, never the word "Depositary" alone, so Sea Limited's ADS and Energy Transfer's Common Units (real common equity) survive. |
| `cleanName(name, symbol)` — **preserves** the share class as `… (Class A)` | The old rule stripped `Class [A-Z]` and everything after it, collapsing `GOOGL` ("Class A Common Stock") and `GOOG` ("Class C Capital Stock") onto the identical display name `Alphabet Inc.` — two adjacent rows, same name, reading as a duplicate. Berkshire is the awkward case: Nasdaq names **both** classes bare `Berkshire Hathaway Inc.` and encodes the class **only in the ticker's slash suffix**, so `cleanName` falls back to reading `BRK/A` → Class A. |

A trailing `Set`-based dedupe on `symbol` guards the rest: Nasdaq has never repeated a symbol in one
response, but a duplicate would render as a genuine duplicate row and React would only *warn*. Net
result: **476 rows, zero duplicate symbols, zero duplicate display names.** (ETFs and commodities are
curated lists and were already duplicate-free; crypto keys on CMC's unique `id`.)

**The size column (`marketCap`) — one column, three different quantities.** The chart endpoint used
for prices carries no size field, so ETFs and commodities used to render a dash here. The numbers do
exist on Yahoo's **`quoteSummary`**, which is crumb-gated (the same lockdown that killed
`v7/finance/quote`): pull a cookie from `fc.yahoo.com`, trade it for a crumb at `v1/test/getcrumb`,
then pass the crumb on every call. `getCrumb()` does that handshake once and caches it 10 min.

| Class | Column reads | Source |
|---|---|---|
| Stocks | Market cap (price × shares outstanding) | Nasdaq screener |
| ETFs | **AUM** — the fund's net assets | `quoteSummary.totalAssets` |
| Commodities | **Notional value** — open interest × price × contract size | `quoteSummary.openInterest` + a hardcoded contract-size table |

A futures contract **has no market cap**, and that isn't an upstream gap to route around: a future is
an *agreement*, not an ownership stake, so there is no share count to multiply by price (Yahoo duly
returns both `marketCap` and `totalAssets` empty for `GC=F`). What it does have is open interest —
contracts currently open — which × price × the exchange contract size gives **notional value**, the
dollar value of all open contracts. That is the futures market's honest analogue of "how big is
this", and being in dollars it sorts and compares against the ETF AUM and stock caps in the same
column. The header therefore relabels itself per class (`MCAP_LABEL`): *Market Cap* / *AUM* /
*Notional*, so a notional value is never misread as a market cap.

Two traps in the notional math, both of which would print a confidently-wrong dollar figure:

1. **Contract size is per-commodity** (gold 100 oz, crude 1,000 bbl, corn 5,000 bu…) and is an
   exchange spec, not market data — hence the hardcoded table in `COMMODITIES`.
2. **Yahoo quotes some futures in cents, not dollars** — the grains (¢/bushel) and the softs +
   cattle (¢/lb). Those carry `cents: true` and get a ÷100; without it their notional comes out
   **100× too large**.

**Rate limiting.** This layer needs a size for 56 symbols (40 ETFs + 16 futures). Firing them
concurrently got ~a third throttled into nulls — indistinguishable from "upstream has no data", but
they weren't: every one returned its number when retried alone. So `fetchSummary()` runs behind a
4-in-flight semaphore with one retry, and a 401/403 drops the cached crumb so the next call
re-handshakes. Result: **ETFs 40/40, commodities 15/16, stocks 500/500.** The lone dash is `CT=F`
(cotton), a genuine upstream 404 — the same symbol that already returns no `shortName`.

**Leaderboard row icons (`marketIcons.ts` / `MarketIcon.tsx`).** Crypto rows carry a CMC logo URL on
the row itself (`thumb` → `CoinIcon`). The screener classes carry **none** — `/api/market/screener`
returns a ticker and nothing else — so before this they all fell through to a coloured letter chip.
`MarketIcon` resolves an icon from the ticker instead. Each class needs a different strategy, and one
of them is a correctness constraint rather than a preference:

| Class | Strategy |
|---|---|
| Stocks (500) · ETFs (40) | Ticker-keyed logo CDNs, walked as a chain: **Parqet** → **FinancialModelingPrep**. Keyed by *ticker*, not a hand-written domain map — with 500 Nasdaq rows a curated map would cover the megacaps and leave the long tail bare. An unknown ticker returns a **zero-byte body**, which fires the `<img>` `onError` and advances the chain, so a miss degrades instead of painting a placeholder. |
| Commodities (16) | **Hand-drawn inline-SVG discs, no network.** A futures root collides with a real equity ticker far too often, and the CDNs answer with the *company's* logo rather than a miss: `CL` is Colgate-Palmolive (not Crude Oil), `KC` is Kraft-Heinz (not Coffee), `LE` is Lennar (not Live Cattle); `SB` and `BZ` likewise. A miss degrades to a letter chip and is merely ugly — **a wrong-but-confident logo is a bug**, so commodities never touch a stock CDN. |

**Base-ticker normalisation.** The last ~3% of the Nasdaq screener isn't random: it's share classes,
preferreds, units and when-issued lines (`BRK/B`, `HBANZ`, `SMCIP`, `GOOGM`, `STRF`…). Each is a
derivative of a company that *does* have a logo, so `baseTicker()` maps it to its underlying
(`BRK/B`→`BRK-B`, `HBANZ`→`HBAN`, `STRF`→`MSTR`) and the chain retries there. Two guards keep this
from becoming the very mislabelling bug it exists to avoid:

1. It runs **only after both CDNs miss on the exact ticker** — so a ticker that already resolves is
   never rewritten. This is what stops `CMCSA` (Comcast) becoming `CMCS`, or `FCNCA` (First Citizens)
   becoming `FCNC` — both *are* matched by the suffix rule, but neither ever reaches it.
2. The suffix strip is length-guarded (5+ chars), so ordinary 1–4 letter tickers can't be truncated
   into another company (`AAPL`→`AAP`). The handful whose base is shorter than that, or isn't a
   substring at all, are listed explicitly in `BASE_ALIASES`.

Net result: **556/556 leaderboard rows across all four classes render a real icon — zero letter
chips.** (Verified by resolving every live ticker through `iconChain()` against both CDNs.) The
lettered chip remains as the last resort, so a dead CDN degrades rather than blanking the column.

**Reach bug fixed in the port.** Reach's Community Sentiment table renders sortable column headers,
but its body maps `list` instead of `sortList(list)` — so clicking "Price" updates sort state and
changes nothing on screen. Here every table routes through the same `sortList`, so the headers work.
Regression-tested in `movers.logic.test.mjs` (`node app/home/wallet/movers.logic.test.mjs`), which
reproduces the original behaviour and asserts ours differs.
- **Footer suppressed** on `/home/wallet` (as on `/home/journal`) — `HomeFooter` returns null; a marketing footer under a full-height dashboard just eats vertical space.

---

## 17. Reports — AI market reports + wall (`/home/reports`)

Four views (`ReportsShell` + `Sidebar`, `ReportsTab = dashboard | daily | weekly | monthly`): a
**Dashboard** feed and three period reports. Each report = the top-20 CMC gainers for its window, a
Binance USDT-pairs section, a sentiment snapshot, and a short LLM analysis. Same mount-once /
keep-mounted / `display:none` tab discipline as `WalletShell` (§16) — a report costs a CMC listing, a
Binance sweep and an LLM call, so a re-fetch per tab switch would be genuinely expensive.

### 17.1 The quality gate — `app/api/reports/_lib/gate.ts`

**The core of the feature, and the reason it produces signal instead of noise.** CMC's listing only
sorts by market cap, so gainers are ranked in-process (as `MoversView` does). But ranking the raw
pool by percent change is worthless: a live 30 d pull put **ANSEM at +152,296 %** and **CASHCAT at
+8,486 %** in the top two slots — near-zero-baseline microcaps and listing artifacts where a
sub-tick move reads as five figures. An LLM handed that list will then confidently narrate a 1,500x
that never economically happened. So the pool is gated *before* it is ranked:

| Threshold | Value | Why |
|---|---|---|
| `MIN_MARKET_CAP` | `> $10M` | below this a percent change is meaningless |
| `MIN_VOLUME_24H` | `> $1M` | below this you can't take a position without moving the price |
| `MAX_CMC_RANK` | `<= 500` | data quality falls off a cliff past the top 500 |
| `MAX_ABS_CHANGE_PCT` | `<= 1000 %` | above this it's a broken baseline, not a rally |

Floors are **exclusive**, the ceiling **inclusive**. Gainers only (`change > 0`). Then sort by the
period's field (`change24h`/`change7d`/`change30d` — `CHANGE_KEY`) and take 20.
**These numbers are load-bearing and easy to drift — change them only deliberately.** Locked by
`gate.logic.test.mjs` (`node web/app/api/reports/_lib/gate.logic.test.mjs`), which pins the real
ANSEM/CASHCAT values and asserts they never appear.

`CHANGE_KEY` is declared in `gate.ts` (not `types.ts`) and re-exported: `gate.ts` must stay free of
runtime imports so it's importable under plain `node`, matching every other tested `.ts` here.

### 17.2 Sources

| Source | Endpoint | Notes |
|---|---|---|
| CMC listing | `data-api/v3/cryptocurrency/listing?limit=500` | keyless, undocumented, needs a browser UA; **only sorts by market cap** |
| CMC spotlight | `.../spotlight?dataType=7\|8` | trending / most-visited / recently-added — the free crowd-attention proxy |
| Fear & Greed | CMC `public-api/v3/fear-and-greed/latest` | keyless |
| Binance daily | `api/v3/ticker/24hr` (bulk) | **1.9 MB, ~3,650 pairs** — server-side only, never proxied; carries **no** 7 d/30 d field |
| Binance weekly/monthly | `api/v3/klines?interval=1d` | one call per pair, 10-concurrent. Measured: 60 calls ≈ 1.8 s, full pass ≈ **5 s** vs the 60 s Hobby limit |

`api/v3/exchangeInfo` is **17 MB** and deliberately never called — `ticker/24hr` already carries every
symbol, and anything quoting 24 h volume is by definition trading. Binance pairs are filtered to
USDT, minus stablecoin quotes (peg noise) and leveraged `…UP`/`…DOWN` tokens (they'd double-count the
underlying's move).

**Pair logos** — Binance's API carries none, so `build.ts` stamps each pair's optional
`RankedPair.thumb` from a CMC base-symbol match: first the already-fetched top-500 listing, then
(only if any pair is still unmatched) one extra thumbs-only listing page covering ranks 501–1500
(`fetchDeepThumbs`, failing soft). First symbol match wins — the listing is market-cap-ordered, so a
collision resolves to the larger coin. Bases CMC doesn't rank (delisted/renamed — COCOS, TOMO) get
Binance's own symbol-keyed logo CDN, `bin.bnbstatic.com/static/assets/logos/{BASE}.png`, which
covers everything Binance trades (an unknown symbol 403s and `CoinIcon` degrades to its initial
chip). `PeriodView` applies the same chain client-side (baked thumb → report's own CMC rows →
bnbstatic) so reports stored before the field existed still show logos, then the shared
`/api/market/coinlogos` map (~7k tickers → CMC s2 ids, which — unlike bnbstatic — ignores the
Referer header) as the universal fallback, and bnbstatic last. **bnbstatic hotlink-blocks**: it 403s
any request carrying a `Referer` header, so `CoinIcon`'s `<img>` sets `referrerPolicy="no-referrer"`
— without it every bnbstatic logo silently degraded to the initial chip in the browser while curl
checks passed.

**Exchange tabs (Binance / Coinbase / Bybit)** — the pairs section has a venue tab strip. Binance is
the report's own baked, period-correct list; Coinbase and Bybit are fetched live from
`/api/market/exchange-movers` on first tab open (24h stats only — the label switches to "24h %" off
Binance), filtered to the same $1M liquidity floor + gainers-only + top-20 as the Binance list.
Each venue has a brand mark in the section header (inline `BinanceMark`/`CoinbaseMark`/`BybitMark`
SVGs via `VENUE_MARK`). Pair logos on the live tabs use the same `pairThumb` chain; the coinlogos
map is what covers venue-only bases (e.g. Bybit's ROAM) that bnbstatic 403s.

**Sortable columns** — both report tables sort client-side on header click (`sortRows`/`cycleSort`
in `PeriodView`, same interaction and `.gl-sortable` header style as `MoversView`): rank and the
alphabetic columns open ascending, numeric columns open descending, second click flips. One sort
state per table; the CMC table's thesis rows travel with their coin row.

### 17.3 The LLM — `_lib/llm.ts`

`gemini-flash-latest` (free tier, ~1,500 req/day; we need 3) → **Groq `llama-3.1-8b-instant` on a 429
only**. Any *other* Gemini failure returns `analysis: null` rather than silently switching provider,
so a real fault stays visible instead of hiding behind a fallback that also changes the report's
voice. `GEMINI_BASE_URL`/`GROQ_BASE_URL` override the endpoints so the path can be exercised against
a local mock without burning quota.

**What the model can and cannot know — the honest limit of this feature.** It receives numbers only:
price, change, volume, market cap, rank, turnover, sentiment. It has **no news feed and no X/Twitter**
(no free read tier — see `_lib/sentiment/x.ts` for the seam and a warning about cashtag astroturfing).
So it can say *"MOVER rose 18 % on turnover worth 40 % of its market cap while Fear & Greed sat at
62"* — real and checkable — but it **cannot say why**, because no causal data is in its input. Asked
"why did this pump?", an LLM will happily invent a partnership and sound authoritative; a fabricated
catalyst is worse than silence because someone may trade on it. Mitigations:

1. The prompt forbids invented causes and mandates the exact phrase **"no clear catalyst identified"**.
2. The prompt forbids buy/sell/hold calls and price targets.
3. A disclaimer is **required, and `validateAnalysis()` rejects the response without it** — and the
   stored text is always our canonical constant, never the model's echo, so a reworded
   "disclaimer" that reads as advice cannot reach the page.

**Rules 1–2 are requests a model can ignore; rule 3 is enforced in code.** That asymmetry is the
known gap, and it is **observable in practice** — measured on identical prompts (2026-07-16):

| | Gemini (primary) | Groq (fallback) |
|---|---|---|
| theses using the mandated "no clear catalyst identified" | **20/20** | **0/20** |
| invented catalysts | none | none |
| investment advice | none | none |
| theses for symbols not in the report | 0 | 0 |
| canonical disclaimer | ✅ enforced | ✅ enforced |

Neither model fabricates — the important property holds on both. But Gemini states its own blind
spot outright ("…has no clear catalyst identified"), while Groq silently omits the phrase and just
describes the numbers. So the fallback is honest, merely less explicit about what it cannot know.
This is exactly why Groq is the fallback and not the primary. A regex/keyword scan for un-sourced
event language ("partnership", "ETF", "hack") is the obvious next hardening step. Theses for symbols not in the report are dropped (a hallucinated row
would imply a ranking that never happened). An empty report skips the LLM entirely — the free tier is
a budget, not a given. Locked by `llm.logic.test.mjs`.

### 17.4 Persistence — Supabase

> **→ §18 is authoritative for the project itself** (which project, every table, both security
> models, what else runs against it, the config traps). This subsection covers only what's specific
> to Reports. Reports does **not** have its own project — web and mobile share
> `koedodxkryyxizcryggy`, and mobile's live user data (`sync_state`/`push_tokens`/`push_alerts`)
> sits in the same database.

Schema: `web/supabase/schema.sql` — apply via the SQL editor, idempotent, safe to re-run.

Tables and RLS: **§18.2**. The design reasoning behind them:

**jsonb, not child rows**, for the ranked coins: written once, always read whole, never queried
per-coin — a join would buy nothing and complicate the upsert. Comments *are* relational: many per
report, arriving independently over time, needing their own ordering.

**Never add a public-insert policy** to the reports tables — it would hand anyone with DevTools
direct write access and reduce the rate limiter to decoration. The default-deny is the whole
security model (§18.2).

**`increment_reaction()` / `decrement_reaction()`** are `security definer` with no grant to
`anon`/`authenticated`, so they're service-role-only. They exist because a read-then-write from the
route would drop concurrent clicks (lost update); the `count = count ± 1` inside the upsert/update is
resolved under Postgres's row lock. Decrement floors at zero (`greatest(count - 1, 0)`) and returns 0
for a missing row — un-reacting something never stored is a no-op, not an error.

**Idempotency.** Vercel does **not** guarantee at-most-once cron delivery, so every write upserts on
`(period, report_date)`. **Verified live**: two authenticated cron runs, both `saved=true`, still one
row, same `id`, `updated_at` advanced — a retry refreshes rather than double-posts.

**Cron: `0 18 * * *`** = 1 PM Cancún. America/Cancun is **UTC-5 year-round** (Quintana Roo dropped DST
in 2015), so no DST branch exists anywhere. One cron routes internally: daily always, `+weekly` if
`getUTCDay()===1`, `+monthly` if `getUTCDate()===1`; periods run **sequentially** so a Monday-the-1st
doesn't fire three Binance batches at once. This puts Vercel Hobby at its **2-cron ceiling**
(keep-alive is the other) — a third needs Pro.

**`keep_alive`** is read daily by `/api/keep-alive` so Supabase doesn't pause the free-tier project.
In practice it's now belt-and-braces: the reports cron writes daily and the mobile app's four
pg_cron jobs hit this database every 15 seconds (§18.3), so it is never idle. It stays because the
route 500s on zero rows by design — a silent no-op ping would be worse than none.

**Cron auth — `_lib/cronAuth.ts`.** A `CRON_SECRET` containing any **non-latin-1** character (an
em-dash or curly quote, which copy-paste introduces silently) can never be sent in an HTTP header —
values are ByteStrings, so `fetch` throws `Cannot convert argument to a ByteString`. A naive
`header === 'Bearer ' + secret` then answers **401 forever**, which is a lie: the secret isn't wrong,
it's *untransmittable*, and an operator would chase a phantom auth bug. So an unsendable secret
returns **`misconfigured` (500) with an explicit log**, distinct from 401. The compare is
length-checked then constant-time. Locked by `cronAuth.logic.test.mjs`; the same guard is inlined in
`keep-alive/route.ts` (which is `runtime = 'edge'` and dependency-free by design).

**Cost surface — the expensive routes are credentialed.** `/api/reports/cron` and
`/api/reports/generate` both require the `CRON_SECRET` bearer. `generate` shipped **open**, which
made it a public "burn the Gemini free tier and hammer CMC/Binance from your own IP" button —
one anonymous POST cost ~25 s of a 500-coin CMC pull, a 1.9 MB Binance ticker, ~174 klines calls and
an LLM round-trip. The in-memory throttle was never a substitute: it's per-lambda-instance, so a
burst landing on cold instances each gets a fresh budget. `preview` is public by necessity (the
client falls back to it) and is bounded instead by its cache — hits are free and never throttled,
misses are 20/IP/min, and an empty build caches for 60 s rather than not at all.

**The service-role key can reach the mobile app's tables** (`push_tokens`/`sync_state`/`push_alerts`)
— RLS is no defence against it. `_lib/supabase.ts` therefore enforces a hardcoded **allow-list**
(`reports`, `report_comments`, `report_reactions`, + the `increment_reaction`/`decrement_reaction` RPCs) and throws on
anything else. Every call site passes a literal today, so nothing can reach them — but the
allow-list means a future route that threads a request param into `table` fails loudly instead of
writing across tenants. Locked by `supabaseGuard.logic.test.mjs`.

**Anonymous writes.** No accounts. `/api/reports/comment` (5/IP/10min) and `/api/reports/react`
(20/IP/10min, emoji restricted to a fixed allow-list) validate input and hold the service-role key.
The limiter is **module state, so per-lambda-instance** — the effective global limit is
N × warm instances. That's acceptable *because it isn't load-bearing*: the tables have no public
write path, so beating the limiter buys extra rows, not access. Nicknames are unverified by design
and the UI says so. Reactions **toggle**: a click adds, a second click removes (`op:'remove'` →
`decrement_reaction`, floored at 0). "My reactions" live in
`localStorage['openview:reports-my-reactions']` (`reactions.ts`, pruned past 50 reports) so the
toggle survives reload — but that's per-browser courtesy, not enforcement — with no identity
there's nothing to enforce against; a hostile client can at worst zero a public counter it could
equally have inflated. Fine for emoji on a market report; **not** fine for anything where the tally
must be trustworthy.

### 17.5 UI notes

Reuses the Gainers & Losers vocabulary (`.gl-page`, `.gl-section-block`, `.gl-cmc-table`,
`.gl-change-pill`, `.gl-page-disclaimer`); the `rp-` classes only cover what that board lacks —
analysis block, thesis rows, feed card. New surfaces sit on `var(--bg)` with no border/tint.
Two gotchas found by screenshotting rather than by DOM assertions:
- `.gl-sections` becomes a **2-col grid** ≥1100 px (built for *paired* gainers/losers). Reports'
  two sections aren't a pair, so `.rp-sections` re-weights them `1.6fr / 1fr`.
- A table auto-sizes to its widest cell, so an unwrapped thesis sentence pushed the table past its
  wrapper into a horizontal scroller. `.rp-table { table-layout: fixed }` + declared column widths
  make the prose wrap instead. Scoped to Reports — the board relies on content-driven sizing.
- `.rp-reaction` names the emoji font stack explicitly: the inherited UI stack has no emoji
  coverage, so on systems without one in the default chain they render as tofu boxes.
- **The pairs table has exchange tabs** (PeriodView): **Binance** · **Coinbase** · **Bybit**,
  rendered with the shared `.gl-class-tab` vocabulary. Binance is the report's own baked,
  period-correct list; Coinbase/Bybit fetch live from `/api/market/exchange-movers` on first open
  (same $1M liquidity floor as `_lib/binance.ts`, gainers only, top 20, shaped into `RankedPair` so
  the one table renders all three). Exchange tickers only publish 24h stats, so those tabs label the
  change column `24h %` whatever the period; the report payload/schema is untouched.

---

## 18. Supabase — ONE project, shared by web + mobile (authoritative)

> **Read this before touching anything Supabase.** This section is the single source of truth. It was
> written after a full audit of both repos plus live queries against the database (2026-07-16),
> because scattered, half-true copies of this information caused real confusion — including a claim
> that the two apps used *separate* projects, and a table listing an `alerts` table that has never
> existed. **Do not restate table/RLS details elsewhere. Link here instead.**

### 18.1 The one fact that matters

**`openvieweb` (this repo) and `openviewapp` (the Expo mobile app) are ONE product sharing ONE
Supabase project: `koedodxkryyxizcryggy`** (org `ayxiemkxfvacqqxrlaed`, project name "openview").
There is no second project. There never was.

Both apps reach it through their own env var names — same project:

| App | URL var | Key var | Key used |
| --- | --- | --- | --- |
| `openvieweb` | `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon in browser; `SUPABASE_SERVICE_ROLE_KEY` in server routes only |
| `openviewapp` | `EXPO_PUBLIC_SUPABASE_URL` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon only — service_role never ships in the bundle |

**A different, unrelated project (`gfdebbumdbrmzvpnyvsm`) belongs to UDG**, a separate music-events
app (venues/artists/events/promoters) at `~/projects/udig` (`UDG-web` + `UDG-app`), under a different
Supabase **account** (the UDG account — not the one owning Openview). `~/.bashrc` exports
`SUPABASE_PROJECT_REF`/`SUPABASE_ACCESS_TOKEN` for **UDG**, and both UDG `.mcp.json` files depend on
them — **never repoint those globals.** If a Supabase tool here returns
venues/artists/events, it is on the wrong project.

### 18.2 Every table in the project (live-verified)

| Table | Owner | Key | RLS policy | Written by |
| --- | --- | --- | --- | --- |
| `reports` | web | `id`; `unique (period, report_date)` | `SELECT` to all; **no write policy** | server routes (service_role) |
| `report_comments` | web | `id` → `reports(id)` cascade | `SELECT` to all; **no write policy** | `/api/reports/comment` |
| `report_reactions` | web | (`report_id`,`emoji`) | `SELECT` to all; **no write policy** | `/api/reports/react` → `increment_reaction()`/`decrement_reaction()` |
| `keep_alive` | web | one row | `SELECT` to `anon`,`authenticated` | nothing (read-only ping target) |
| `sync_state` | mobile | (`user_id`,`key`) | own-rows: `select/insert/update/delete` where `auth.uid() = user_id` | the app (anon key) |
| `push_tokens` | mobile | (`user_id`,`device_id`) | own-rows: `ALL` | the app (anon key) |
| `push_alerts` | mobile | `alert_key` = `"<device_id>:<engine_id>"` | own-rows: `ALL` | the app + `alert-watcher` |

**Two different security models coexist here, deliberately:**
- **Web/Reports = public read, zero client writes.** No accounts. RLS default-deny means the anon key
  in the browser can read and write nothing; every write goes through a rate-limited server route
  holding the service_role key. Verified live: anon `SELECT` → 200, anon `INSERT` → **401**.
- **Mobile = own-rows via anonymous auth.** `signInAnonymously()` gives each install a real
  `auth.uid()`; every policy is `auth.uid() = user_id`. **Anonymous sign-ins must stay ON**
  (Auth → Providers) or the mobile app silently loses all sync/push.

Schemas: `web/supabase/schema.sql` (web's four) and `openviewapp/supabase/schema.sql` (mobile's
three). Both idempotent. **Neither file describes the whole project** — that's this table's job.

### 18.3 What runs against this database

| Job | Schedule | Where | Does |
| --- | --- | --- | --- |
| `alert-watcher-every-min` + `-15s`/`-30s`/`-45s` | `* * * * *` ×4 (offsets `pg_sleep` 15/30/45) | **pg_cron in Postgres** | `net.http_post` → the `alert-watcher` Edge Function. ~15s worst-case closed-app alert latency. **All four active.** |
| `/api/keep-alive` | `0 9 * * *` | Vercel cron | anon-key read of `keep_alive` so the free tier doesn't pause |
| `/api/reports/cron` | `0 18 * * *` | Vercel cron | builds + upserts the daily report (+weekly Mon, +monthly 1st) |

Vercel Hobby allows **2 crons** — both are used. A third needs Pro. The pg_cron jobs are separate and
don't count against that.

**`alert-watcher`** (`openviewapp/supabase/functions/alert-watcher/index.ts`) is the only Edge
Function: scans active `push_alerts` → prices (Coinbase / Binance) → Expo Push → updates
`last_price`/`last_fired_at`, prunes dead tokens. Deployed `--no-verify-jwt`, gated by an
`x-watcher-secret` header. Requires extensions **`pg_cron`** + **`pg_net`**.

**Vault holds two secrets** (`vault.secrets`, created 2026-07-10): `service_role_key` and
`watcher_secret` — the cron reads both at call time so neither appears in the schedule definition.

> ⚠️ **Rotating `SUPABASE_SERVICE_ROLE_KEY` breaks push alerts** unless the Vault copy is updated in
> the same pass. That's not hypothetical — four live cron jobs read it every 15 seconds.

### 18.4 Config that has already bitten us — don't repeat it

- **`openvieweb/.mcp.json` is gitignored, untracked, and hardcodes the project ref + access token.**
  It used `${SUPABASE_PROJECT_REF}`/`${SUPABASE_ACCESS_TOKEN}`, which resolved to **UDG's** project.
  **The trap in one line: an MCP config is per-project, but `${VAR}` escapes to the global shell** —
  so a local file silently produced global behaviour, and any project reusing those generic variable
  names inherits UDG's database. (A 2026-07-16 audit found `~/projects/zenbot` has exactly this bug:
  its app uses its own project, its MCP reads the globals. `offix`/`fami` hardcode theirs and are
  fine. When you find this bug, grep for other instances — configs get copy-pasted.)
  A dedicated `${OPENVIEW_SUPABASE_TOKEN}` var *still* failed: Claude Code inherits its environment
  from the **VS Code server process**, started long before any `~/.bashrc` edit, so the placeholder
  resolved empty and a stale token persisted. Hardcoding removes the inheritance puzzle; the
  gitignore keeps the token out of git (no token was ever committed — every committed version used
  placeholders). **Consequence: `.mcp.json` is per-developer.** The MCP reads it at startup → any
  change needs a Claude Code restart.
- **Access tokens are per-Supabase-account, not per-project.** The UDG account's token can
  *only* ever see UDG. An Openview token must come from the account owning Openview.
- **`CRON_SECRET` must be plain ASCII** (`openssl rand -hex 32`). A pasted em-dash or curly quote
  cannot be sent in an HTTP header at all, so no caller could ever authenticate — see §17.4.

### 18.5 If you remember nothing else

1. **One project. Web + mobile. `koedodxkryyxizcryggy`.**
2. `gfdebbumdbrmzvpnyvsm` is **UDG's**, a different app on a different account. Not ours.
3. This project holds **real user data** (push tokens, sync state) — not just public market data.
   Never treat a destructive statement here as "just reports".
4. Reports tables: public read, **zero** client writes. Mobile tables: own-rows via anon auth.
5. Rotating the service_role key means updating **Vault** too, or push alerts die silently.
