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
| HTML skeleton | 789–913 | `<body>` tree: `#toolbar` (left drawing bar), `#main` > `#topbar` + `#chartWrap`/`#chart`/`#draw` + `#rsiWrap`/`#rsi` + `#subPanes`, floating UI (`#ctxMenu`, `#indicatorsMenu`, `#alertsPanel`, `#settingsDlg`, `#alertDlg`, `#scriptDlg`, `#symDlg`, `#pairCard`, `#dlgBackdrop`), `#watchlist` |
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

Coinbase and Binance/Bybit send permissive CORS headers, so the browser fetches them directly. Yahoo Finance does not; those calls are relayed through `proxyJSON()`.

### Fetch timeout — `fetchTimeout(url, ms=8000, opts)`

Every upstream candle/proxy request goes through `fetchTimeout`, a thin `fetch` wrapper that aborts via `AbortController` after `ms` (default 8 s). Without it, a stalled endpoint (socket accepted but no response) blocked the awaiting page-loader forever: the cursor-stepping progressive loop can't advance past a hung page, so the chart sat on "Loading…" indefinitely — the "sometimes it glitches and takes too long to load" symptom. The timeout turns a stall into a normal rejection, so the existing per-fetcher retry/backoff (Coinbase) or catch-and-return-`[]` (Binance/Bybit/Yahoo) runs and the loop exits cleanly. All four `fetchPage*` fetchers and `proxyJSON` use it. See `test/regression_fetch_timeout.mjs`.

### CORS proxy chain

`CORS_PROXIES` is an ordered array of three free relay functions (allorigins, corsproxy.io, thingproxy). `proxyJSON(url)` attempts each proxy, parses the response body as JSON (rejecting HTML error pages), and retries all three a second time after a 500 ms pause before giving up. Used only for Yahoo Finance calls.

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

MAs (default: seven EMAs 7/25/99/150/200/300/400) are held in the mutable `MAS` array (`{p, color, w, on, type, src, ls}`) and rendered directly in `renderData` via `renderMaLegend` → `maLine`. `maLine(data, m)` picks the source column (`src`: close/open/high/low/hl2/hlc3/ohlc4) and MA kind (`type`: sma/ema/wma/rma via `smaA`/`emaA`/`wmaA`/`rmaA`). They are **editable**: the `#maLegend` row ends with a ⚙ gear (`#maGear`) opening `openMaSettings` — a dialog to change each MA's type, period, source, color, width, line style, toggle visibility, add/remove, and Reset to defaults (`DEFAULT_MAS`). Add/remove rebuilds the line series via `rebuildMaSeries` (`maSeriesOpts` shares the option shape); edits persist to `localStorage["fv_mas"]` (`saveMas`). The legend label reflects the type (e.g. `EMA25`, `SMMA99`) via `maTag`. RSI(14) is rendered via `rsiSeries` / `maOfSeries` into the built-in `#rsiWrap` pane (not part of `indicators[]`). The pane is HOSTED inside `#subPanes` so it can be reordered; its label carries ↑/↓ move-pane, ▁ collapse, ⚙ settings, × close (no maximize) (persisted `fv_rsi_on`; the chart's right-click menu gains "Show RSI pane" while closed) — and a `.paneResize` grip on its top border drags the pane taller/shorter (70px … 60% of window), resizing the LWC chart live.

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
| `fv_wl_hidden` | array of legs whose watchlist price cells are masked as `••••••` (the per-row eye toggle) | `saveWlHidden()` | boot into `WL_HIDDEN` set |
| `fv_alert_log` | `ALERT_LOG[]` — fired-alert history (`{ts, symbol, text}`) | `logAlert()` / `clearNotifications()` | boot; Notifications panel |
| `fv_notif_seen` | timestamp of last Notifications-panel open (drives the unread bell badge) | `openNotificationsPanel()` | `notifUnreadCount()` |
| `fv_wl_width` | watchlist panel width in px (`--wl-w`) | `#wlResize` drag | boot |
| `fv_flags` | `SYMBOL_FLAGS` — symbol → hex flag color | `setSymbolFlag()` | boot |
| `fv_rsi_on` | built-in RSI pane visibility ("0" = closed via the pane's ×; restored via chart right-click → "Show RSI pane") | `hideRsiPane()` / `showRsiPane()` | boot |
| `fv_mas` / `fv_rsi_params` | editable MA set / RSI params + style | `saveMas()` / RSI settings | boot |
| `fv_layout` / `fv_layouts_named` / `fv_grid_sync` | active grid layout + per-panel symbols / named layouts / SYNC-IN-LAYOUT toggles | `persistLayout()` / `saveNamedLayout()` / grid-sync toggles | boot |
| `fv_watchlists` / `fv_active_wl` | all named watchlists / active name | `saveWatchlists()` | boot (legacy `fv_watchlist` migrated) |

| `ov_trades` | `Trade[]` — the trade journal (see §15). Written by the **Next app**, not the engine, hence the `ov_` prefix rather than `fv_`. | `saveTrades()` / `addTrade()` in `app/home/journal/trades.ts` (via the right-click → Add Trade modal) | `loadTrades()` in `app/home/journal/trades.ts` |
| `ov_notes` | `Note[]` — the notes board (see §15). Sorted pinned-first, then most-recently-updated. | `addNote()` / `updateNote()` / `deleteNote()` in `app/home/journal/notes.ts` | `loadNotes()` (same file) |
| `ov_holdings` | `Holding[]` — wallet portfolio (see §16). Fields are Reach's snake_case (`asset_type`, `avg_buy_price`) so holdings stay portable with the desktop app. | `addHolding()` / `updateHolding()` / `deleteHolding()` in `app/home/wallet/holdings.ts` | `loadHoldings()` (same file) |
| `ov_portfolio_snapshots` | `Snapshot[]` (`{t, value}`) — portfolio-value time series backing the History chart. Appended on each successful price poll, throttled to one per 5 min, capped at 26k points. Reach stores these in SQLite; with no server DB they live here, which is why the chart shows "Collecting data" until two polls land. | `recordSnapshot()` in `app/home/wallet/holdings.ts` | `loadSnapshots()` (same file) |
| `ov_tracked_wallets` | `TrackedWallet[]` (`{id, address, chain, label?}`) — on-chain addresses watched by the Wallet Tracker (see §16). Seeded with Reach's 20 known whale/exchange wallets **only when the key has never been written** (`raw === null`); an explicitly-stored `[]` is honoured as empty, so a user who clears the list doesn't get all 20 back on reload. | `saveTracked()` in `app/home/wallet/chains.ts` | `loadTracked()` / `defaultWallets()` (same file) |

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

**Right rail (full TV icon set)** — a far-right vertical icon rail (`#rightRail`), split by a flex `.rr-spacer` into a **top group** (Watchlist, Alerts, Object tree, Ideas&Chat) and a **bottom group** (Technicals, Screener, Economic calendar, News, Notifications, Apps, Paper trading, Help). All 12 buttons are thin-line monochrome SVGs (`ICON.*`, `currentColor` `#b2b5be`, 20px) with `title` tooltips. The active panel's icon highlights blue (`.rr-active` → `#2962ff`) via `setRailActive(kind)` (exposed on `window` for the dock controller), which persists to `localStorage["fv_rail_active"]`; boot re-clicks the stored button so the last panel re-opens.

**Docked right-sidebar panel** — every rail icon opens its panel DOCKED in `#rightPanel` (a flex sibling of `#watchlist` inside `#app`), never floating: `openDock(kind, title, render)` hides the watchlist (`html.dock-open`), renders into `#rpBody` (with an optional `#rpHead` title + ×), and highlights the icon; `closeDock()` restores the watchlist; `railToggle(kind, openFn)` gives one-panel-at-a-time semantics — clicking another icon switches panels, clicking the active icon closes. The Watchlist icon simply closes the dock. **Alerts** docks by re-parenting the existing `#alertsPanel` element into the dock (`openAlertsDock`, `.docked` CSS overrides); `undockAlertsPanel()` returns it to `#app` on switch/close, so the floating `toggleAlertsPanel` path (topbar right-click, backdrop) still works.

Rail panels: `railPanelShell(title, html, kind)` renders into the docked `#rightPanel` (one panel open at a time; the floating `#stubPanel` is gone). **Technicals** (`openTechnicalsPanel`) computes real votes from `lastData` via `technicalsVotes()` — SMA/EMA 10/20/30/50/100/200 vs close plus RSI(14)/MACD(12,26,9)/Stoch %K/CCI(20)/Momentum(10)/Williams %R(14) with classic thresholds — and `technicalsVerdict()` maps net score to Strong Sell…Strong Buy, rendered as an SVG semicircle gauge + counts + per-check rows. **Notifications** (`openNotificationsPanel`) lists `ALERT_LOG`; unread = entries newer than `fv_notif_seen`, shown as a red `.rr-badge` count on the bell (`updateNotifBadge`, called from `logAlert` and at boot; opening the panel stamps `fv_notif_seen` = now and clears the badge). A **Clear all** button (shown only when the log is non-empty) calls `clearNotifications()` — empties `ALERT_LOG`, clears `fv_alert_log`, re-renders the panel to its empty state, and refreshes the badge. **Help** (`openHelpPanel`) shows the `KEY_SHORTCUTS` keyboard-shortcuts list plus an **AI assistant — MCP + API** section: live bridge status (Off / Waiting for bridge server / Connected, from `AGENT_ON` + `window._agentLinked` via `agentHelpStatus()`, refreshed every 2s by a self-clearing interval while the panel is open) and the quick-start steps + tool/endpoint summary for the LLM bridge (§14). Ideas/News/Screener/Calendar/Apps/Paper open `openStubPanel(kind)` — placeholder shells (no backend in this single-file build). **Resizable watchlist**: `#wlResize` grip drags the panel width (200px–50%, `--wl-w` CSS var, persisted `fv_wl_width`); the topbar/grid use `right:0` inside `#main` so they follow the resize.

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

**Pair info card** — `showRowMenu`'s "View details" opens `openPairInfoCard(sym)`, a floating card (`#pairCard`; Esc or × close it, `closePairCard`). It has **no backdrop** — it floats over the chart without dimming it, so you can still see/interact with the chart behind — and is **draggable by its header** (`pcDragWire`: on first drag it swaps the centered `translate(-50%,-50%)` for pixel `left/top` and follows the cursor, clamped to the viewport; drags starting on the ×, arrows, or dots are ignored). It shows the pair (logo, exchange, spot/perp/spread type), a large last price + 24h change, then data-filled sections: **Market·24h** (24h high/low, base + quote volume, range position, prev-close/open) from `fetchRichStats(leg)` — a per-venue ticker call (Coinbase `/stats`; Binance `/ticker/24hr?symbol=`; Bybit `/tickers?symbol=`; Yahoo chart meta, each surfacing venue-specific extras like Binance weighted-avg/trade-count, Bybit funding/open-interest, Yahoo 52-wk range) — **Technicals·Daily** (RSI 14 with a gradient meter, SMA 20/50 + trend, ATR 14, 1Y high/low) computed from a daily candle fetch (`fetchCardCandles`, which `makeRatio`s both legs for a spread), and a **Pair** section (symbol/type/exchange or numerator/denominator). Footer has **Open chart** + **Add alert**. Every field degrades to "—" when a source is unavailable; a `_pairCardSeq` guard drops stale async fills. Distinct from the topbar's lighter `showSymbolInfo` popover.

The card is 560px wide with a **3-column** stat grid (wider + shorter than the old 2-col), a gradient header with a type badge, a colored change chip, and section headers with trailing rules. **Every stat cell carries a hover help box** — `pcCell` looks the label up in `PC_HELP` (plain-language definitions) and emits `data-help`; a CSS `::before` renders the box on hover (a `?` hint appears in the cell key), with rightmost-column cells (`nth-child(3n)`) anchoring the box to their right edge so it stays on-card. Each section is built with `pcGrid(cells)`, which pads a partially-filled final row with blank `.pc-fill` cells (panel-colored, non-interactive) so a 2-of-3 row never leaves a dark gap. **`pcCell(k,v)` HTML-escapes the value itself** (via `escHtml(String(v))`) — the single choke-point that keeps raw API strings (e.g. Yahoo's `currency`) and symbol text out of `innerHTML`; numeric values additionally pass through `fmtPrice`, which returns `"—"` for `null`/`NaN`/`±Infinity` so a missing exchange field never renders as literal `NaN`.

The card is a **3-page carousel** (`.pc-track` slides via `#pairCard.pg1`/`.pg2`, `PC_PAGES=3`; two header arrows ‹ › sit side-by-side left of the × and step pages, footer dots jump, `wirePairCardNav` tracks `_pcPage`; both arrows are always rendered and get `.disabled` — dimmed + non-clickable — at the ends: ‹ on page 0, › on the last page). **Page 0** is the details above. **Page 1** is a **multi-timeframe RSI** table (`loadRsiPage`, lazy on first nav): one row per timeframe in `PC_RSI_TFS` (1m,5m,15m,30m,1h,2h,4h,6h,12h,1d,1w,1M), each showing RSI(14)-close (green oversold / red overbought / white neutral) on a gradient meter with a dot. **Page 2** is a **multi-timeframe SMA** matrix (`loadSmaPage`, lazy): a TF×period table (rows = the 12 TFs, columns = `PC_SMA_PERIODS` 7/25/99/150/200/300) with a sticky TF column, each cell the last SMA value colored green when the last close is above it, red when below ("—" when history is shorter than the period). Both pages fetch candles per TF via `fetchTfBars(sym, tf, isSpread)` (single leg or `makeRatio` spread) and fill rows/cells as they land, guarded by `_pairCardSeq` (card changed) and `_rsiPageSym`/`_smaPageSym` (avoid refetch). RSI also uses `fetchSpreadRsi`/`rsiFromBars`.

Drawings are keyed per **symbol + timeframe** so a BTC-USD 1D layout does not clobber BTC-USD 1H. Scripts, alerts, and indicators are keyed per **symbol only**. Active symbol/TF, timezone, and indicator favorites are global. So a reload restores the full workspace: symbol, timeframe (incl. custom), drawings, indicators (with params + hidden state), alerts, scripts, and timezone.

---

## 10. Watchlist

The watchlist panel (`#watchlist`, default 300px, resizable via `#wlResize` — see §8, persisted `fv_wl_width`; background `--bg` with a `--border` left divider) renders `GROUPS[]` as collapsible sections with draggable rows. `DEFAULT_GROUPS` seeds two sections (ALPHA, SECTION 2). A one-time migration (`migrateComebackDefault`, guarded by `localStorage["fv_wl_reset_v3"]`) resets the "comeback" list to that default once per browser, then never again — so a user's later customisations survive reloads. Section headers show a `−` glyph when expanded and `+` when collapsed (`.caret`; click toggles collapse). **Whole sections are draggable to reorder**: each header is `draggable` and wired by `groupDragWire` (`wlGroupDrag` state, `.gdrop-above`/`.gdrop-below` indicators) → `moveGroup(fromName,toName,before)` splices the group within `GROUPS`; a completed drag sets `_groupDragged` to swallow the trailing collapse-click. This is distinct from row (symbol) drag (`wlDragWire`/`moveSymbol`) and from dropping a symbol onto a header (`sectionDropWire`); all three drop paths guard on their own drag state so they never collide.

### Groups and rows

`buildWatchlist()` clears `#wlBody` and iterates `GROUPS`. Each group gets a `.section` header with collapse toggle and a trash icon (visible on hover). Each symbol gets a `.row` with a coin logo (`logoForBase` via CoinCap CDN; spreads get a diagonally-split circle via `splitIconHtml` — leg A's icon in the top-left triangle, leg B's in the bottom-right (`clip-path` polygons with a thin seam), letter-half fallback on 404/NO_LOGO; also used for the pair-info card's `pc-ic`), exchange badge, last price, absolute change, and percent change columns plus a per-row trash icon and an eye (view) toggle beside it. The eye (`.eye`, `icEyeWl(sym)` — slashed when hidden) masks **that one symbol's** price cells (Last/Chg/Chg%) as `••••••` via `toggleWlPrice(sym)`; the masked legs live in the `WL_HIDDEN` set (persisted in `localStorage["fv_wl_hidden"]`), the row carries `.masked` (dimmed muted cells), and `refreshPrices` early-returns for a hidden symbol so live ticks don't overwrite the mask (`PRICE_CACHE` still updates so sorting works). Toggling off calls `refreshPrices()` to repaint real values. Masking is per-asset, never list-wide.

Row click: sets `activeSymbol`, calls `loadPersisted` / `loadAlerts` / `loadScripts`, then `loadChart`.

### Drag-to-reorder

HTML5 drag-and-drop via `wlDragWire(row)`. Dragging a row over another shows a blue insertion indicator (`.drop-above` / `.drop-below`). `moveSymbol(fromGroup, fromSym, toGroup, toSym, before)` splices the symbol in `GROUPS` and calls `saveGroups` + `buildWatchlist`. Dropping onto a collapsed section header (`.section`) appends to that group via `sectionDropWire`.

### Add-symbol dialog — `openAddSymbolDlg`

Opens `#symDlg` with a search input and exchange tabs (All / Coinbase / Binance / Bybit / TradingView / **Spread**). `loadProducts()` fetches the full product list from all four crypto venues in parallel via `Promise.allSettled` (a venue that fails is silently skipped). Results are cached in `PRODUCTS`.

The "TradingView" tab fetches from Yahoo Finance's search endpoint (`/v1/finance/search`) via `fetchTVResults(q)` then `proxyJSON`. Results are cached in `tvCache` per query. `scheduleTVSearch(q)` debounces remote calls by 220 ms and guards against stale async responses with a sequence counter (`tvSeq`).

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

### Supabase schema — `supabase/schema.sql`
| Table | Key | Columns | RLS |
| --- | --- | --- | --- |
| `sync_state` | (`user_id`,`key`) | `device_id, value jsonb, updated_at` | own-rows (select/insert/update/delete) |
| `alerts` | `id` | `user_id, symbol, op, target, message, active, triggered_at, created_at` | own-rows (all) |
| `push_tokens` | (`user_id`,`device_id`) | `token, updated_at` | own-rows (all) |

Requires **Anonymous sign-ins ON** (Auth → Providers). Setup + Edge Function deploy/cron steps are in `openviewapp/README.md`.

### MCP
Root `.mcp.json` registers the Supabase MCP server (`@supabase/mcp-server-supabase`, `--read-only`), reading `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` from the environment (no secrets committed). Authorizing/activating it requires an interactive session.

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
5. **Supabase** lives only in `openviewapp` and is **not touched** — "keep Supabase identical" is satisfied trivially.

### Route map (`web/app/`)

| Path | Served by | Notes |
|---|---|---|
| `/` | `public/index.html` (rewrite) | **Chart engine, verbatim.** Mobile + grid + embed contract. |
| `/index.html?…` | `public/index.html` (static) | Grid iframe `src`. 200 direct, params preserved. |
| `/assets/*`, `/images/*` | `public/` | Engine icons, sounds, screenshots — same relative paths. |
| `/home` | `app/home/page.tsx` | **Landing page.** Hero-only "OpenView". |
| `/home/openview` | `app/home/openview/page.tsx` | Platform description (what OpenView is). |
| `/home/app` | `app/home/app/page.tsx` | The phone app. |
| `/home/about` | `app/home/about/page.tsx` | Who we are. |
| `/home/journal` | `app/home/journal/page.tsx` + `JournalShell.tsx` (`'use client'`) | **Trade journal dashboard** (folder-tab "Journal"): sidebar + Calendar/Notes. See §15. |
| `/home/wallet` | `app/home/wallet/page.tsx` + `WalletShell.tsx` (`'use client'`) | **Wallet dashboard** (folder-tab "Wallet"): sidebar + Wallet / Gainers & Losers / Wallet Tracker. See §16. |
| `/api/market/prices` | `app/api/market/prices/route.ts` | POST holdings → `{symbol: {price, change24h}}`. Server-side price proxy (§16). |
| `/api/market/movers` | `app/api/market/movers/route.ts` | GET metals + currencies + stocks/ETFs ranked by 24h move (§16). |
| `/api/market/cmc` | `app/api/market/cmc/route.ts` | GET CoinMarketCap listing + spotlight + Fear & Greed — powers the market page's 6 crypto tabs (§16). No API key; see §16. |
| `/api/wallet-tracker` | `app/api/wallet-tracker/route.ts` | POST `{action: balance\|tokens\|prices}` — on-chain lookups across 10 chains (§16). |

`/home/*` share `app/home/layout.tsx` → dark folder-tab bar (`OvTabs`, tabs: Home · Openview · Journal · Wallet) + heading nav (`app/home/HomeNav.tsx`: Home · Openview · APP · About us). `OvTabs` is a client component that derives the active tab from `usePathname()`. The raw engine tab bars (`index.html`, `web/public/index.html` `#ovTabs`) mirror the same tabs (Journal/Wallet link to `/home/journal`, `/home/wallet`). The nav "Openview" is the **description** page (`/home/openview`), NOT the chart — the chart is the folder-tab "OpenView" → `/`. Old `(site)` navbar pages (`/about`, `/portfolio`, `/contact`) are unrelated leftovers.
| `/about` | `app/(site)/about/page.tsx` | Marketing copy. |
| `/portfolio` | `app/(site)/portfolio/page.tsx` | Project cards. |
| `/contact` | `app/(site)/contact/page.tsx` + `ContactForm.tsx` (`'use client'`) | `mailto:` form, no backend, no stored data, no secret. |
| `/chart` | `app/chart/page.tsx` + `ChartEngine.tsx` (`'use client'`) | Full-viewport engine iframe for in-app nav (no navbar). |

**Folder-tab bar (Home ↔ OpenView):** a dark, browser-tab-style bar. It exists in TWO places kept visually identical: (1) injected into the chart engine as `#ovTabs`, first child of `<body>` in `index.html` — `html:not(.embed) #app` shrinks to `calc(100vh - 34px)` to make room, and `html.embed #ovTabs{display:none}` hides it so the **phone app / grid panels (embed=1) show only the chart, no tabs**; (2) the React `app/OvTabs.tsx` component used by `/home`. The "OpenView" tab → `/` (chart), "Home" tab → `/home`. Styles mirror each other (`.ov-tabs`/`.ov-tab` in globals.css ≡ `#ovTabs` in index.html).

Layout structure: `app/layout.tsx` (root `<html><body>`), `app/(site)/layout.tsx` (adds `Navbar` — used by /about, /portfolio, /contact only; /home is standalone with `OvTabs`). The `(site)` route group scopes the navbar to marketing pages; `/chart` sits outside it (full-viewport, no navbar). Site chrome CSS in `app/globals.css` mirrors the engine's TV colour vars. Single client-nav component `app/Navbar.tsx` (uses `usePathname` for the active link; "Open Chart" is a plain `<a href="/">` so it does a real navigation to the static engine).

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

Mirrors Reach's SQLite `trades` columns (snake_case) so trades stay portable between the two apps: `id`, `trade_date` (`'YYYY-MM-DD'`), `symbol`, `direction` (`long|short`), `asset_class`, `entry_price`, `exit_price`, `position_size` (USD notional), `pnl` (**already net of commissions**), `commissions`, `margin`, `trade_type` (`spot|futures`), `amount_asset` (spot only, else `null`), `is_open`, `setup_tag`, `notes`.

Persisted at `ov_trades` (see §9). `loadTrades()` returns `[]` on the server, on missing/corrupt JSON, or if storage is blocked, and coerces every field — a malformed entry is dropped, never thrown. `saveTrades()` writes the whole list back (silently no-ops if storage is blocked/full). `addTrade()` **re-reads storage before appending** and derives the new `id` from the current max, so a write from another tab is never clobbered by a stale in-memory copy.

### Adding a trade

**Right-click any day cell** → a context menu with **+ Add Trade** → `TradeModal`, prefilled with that cell's `'YYYY-MM-DD'` key (the date is fixed; everything else is entered). Dismiss the menu with a click anywhere, a scroll, a resize, or Escape; it is `position: fixed` at the cursor and clamped back inside the viewport so it never opens off-screen.

`pnl` is **derived in the modal, not by the calendar** (which only aggregates). Quantity = `position_size / entry_price`, so a $10k long from 100 → 110 nets $1,000; the move is `exit - entry` (long) or `entry - exit` (short), minus commissions. The footer shows this live. Checking **Still open** disables the exit field and forces `pnl` to 0 — consistent with the aggregation rule below. `amount_asset` is filled for spot only (`size / entry`), `null` for futures.

### Aggregation rules

- **Open trades** (`is_open`) count toward a day's *trade count* but contribute **no P&L** to any total.
- **Month totals** are scoped with `isSameMonth`, so the adjacent-month padding days visible in the grid never leak into Net P&L / win %.
- **Trade Win %** = winning ÷ closed trades; **Day Win %** = winning ÷ trading days (a day wins if its summed P&L > 0). Breakeven (`pnl === 0`) is tracked as its own bucket in both gauges.
- **Daily Net Cumulative P&L** is a running sum, one point per trading day in date order; it renders "Not enough data" below 2 points. Y-axis ticks snap to a `[1,2,2.5,5,10]×10ⁿ` step.
- Dates are parsed as **local** (`new Date('YYYY-MM-DDT00:00:00')`) and keyed without `toISOString()`, so no trade shifts a day across timezones.

The current month depends on the client clock, so the component renders an empty shell until mount (`useState(null)` + `useEffect`) rather than risk a hydration mismatch. A `storage` listener keeps the calendar live if trades are written in another tab.

### Scope / not built

Only the **month view** exists — the Day/Week toggle buttons are present but `disabled`. Trades can be **added** (sidebar New Trade, or right-click a day → modal) but not yet **edited or deleted from the UI**; `deleteTrade()` exists in `trades.ts` with no caller. Notes, by contrast, are fully CRUD. Reach's undo/redo, Ctrl+scroll zoom, sidebar drag-to-resize, and the Customize/finance widget were left out, as were its other nav destinations (Wallet, Trading View, Quant, Gainers & Losers, Heatmap, Wallet Tracker, News/X). Unlike Reach there is no auth/user scoping (no `user_id`) — trades and notes are per-browser, in localStorage.

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

A three-view dashboard ported from the **Reach** desktop app, replacing the old "Coming soon" placeholder. Reuses the Journal's shell (`.journal-shell` / `.journal-sidebar` / `.nav-item`) so both dashboards read as one product. Sidebar: **Add Asset** button · Wallet · Gainers & Losers · Wallet Tracker · live clock.

`/home/wallet` costs **13.8 kB** (101 kB First Load). Movers + Tracker are `next/dynamic` code-split — neither is needed for the wallet's first paint.

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
| **Market page (crypto)** | CoinMarketCap `data-api/v3` + alternative.me | same, via `/api/market/cmc` |

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
| `api.alternative.me/fng/?limit=1` | The Fear & Greed gauge on Community Sentiment |

⚠ `spotlight`'s `limit` is validated upstream to **5–30**; outside that range it returns a 400.

**Risk:** `data-api/v3` is undocumented and may change or rate-limit without notice. Every fetch
therefore fails soft — a dead endpoint yields an empty list, never a throw — the three sources are
fetched independently so one failure can't blank the others, results are cached 30 s (the client
polls at the same cadence), and a total wipeout is never cached.

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
| `web/app/home/wallet/WalletShell.tsx` | `'use client'` — owns the active view; code-splits Movers/Tracker. |
| `web/app/home/wallet/Sidebar.tsx` | `'use client'` — Add Asset button, 3-item nav, live clock; resizable + collapsible via `useSidebarResize` (§15). |
| `web/app/home/wallet/WalletView.tsx` | `'use client'` — 4 stat cards, History chart, Allocation donut, assets table. |
| `web/app/home/wallet/AddAssetModal.tsx` | `'use client'` — 4 category tabs, search, asset grid, amount / avg-buy-price. |
| `web/app/home/wallet/MoversView.tsx` | `'use client'` — the 8-tab market page (see below). |
| `web/app/home/wallet/CoinIcon.tsx` | `'use client'` — CMC coin logo, falls back to a coloured initial on 404. |
| `web/app/home/wallet/movers.logic.test.mjs` | Node test for the market page's derivations (sort, sentiment, pool, formatters). |
| `web/app/home/wallet/WalletTrackerView.tsx` | `'use client'` — address form, wallet cards, token-detail overlay. |
| `web/app/home/wallet/assets.ts` | Asset catalog (~200 crypto / 50 stocks / 4 metals / 10 currencies) + logo/colour/glyph resolution + shared formatters. |
| `web/public/metals/*.gif` | Reach's animated metal coin sprites (gold / silver / platinum / palladium), 32×32. |
| `web/app/home/wallet/holdings.ts` | `ov_holdings` + `ov_portfolio_snapshots` persistence. |
| `web/app/home/wallet/chains.ts` | 10-chain config, `detectChain()`, `ov_tracked_wallets` persistence. |
| `web/app/home/wallet/AssetIcon.tsx` / `icons.tsx` | Asset avatar w/ fallback chain; inlined Lucide glyphs. |

**No new dependencies.** As in the Journal: both charts are hand-rolled inline SVG (Reach uses no chart lib either), and the Lucide glyphs are inlined as SVG paths.

**Metal logos.** The four metals use Reach's animated coin sprites, copied from its `src/assets` into `web/public/metals/` (32×32 GIFs, ~7KB total). Reach's own mapping is *not* the obvious one — its `XAG` points at `Platinum_Coin.gif` and its `XPT` at `Crystal_Coin.gif`, because the Tibia platinum coin reads as silver and the crystal coin as platinum. That indirection is resolved **at the filename** on copy (`gold/silver/platinum/palladium.gif`), so `METAL_LOGOS` stays literal. Reach's `metalSvg()` data-URI coins are retained as `METAL_SVGS` and serve as the `onError` fallback, so a missing sprite degrades to a drawn coin rather than a blank chip. The GIFs render with `object-fit: contain` and `image-rendering: pixelated` (`.wallet-icon-img-metal`) — `cover` would crop the round coin's edges and smoothing would blur the pixel art at 28–40px.

Reach also appends a `?t=${Date.now()}` cache-buster so every GIF instance starts its animation on the same frame; that is **deliberately not ported** — at module scope in Next.js it differs between server and client, which hydration-mismatches the `src` attribute, and it defeats HTTP caching. The coins simply animate out of phase.

### Notable behaviours

- **History chart** needs a time series. Reach keeps snapshots in SQLite; with no server DB they go to `localStorage` on each price poll. The chart therefore shows Reach's own **"Collecting data"** empty state until two snapshots exist — expected on first load, not a bug.
- **Token cap.** Blockscout's `token-balances` is unbounded: a long-lived address (Vitalik's) returns **~3 MB / 6.6k tokens in ~6 s**, mostly worthless airdrop spam. Two consequences, both handled: the fetch needs a **25 s** timeout (the default 8 s silently clipped it and yielded an empty list — a real bug caught in testing), and the response is **sorted by value and capped at 100**. The `totalUsd` is summed over *all* tokens before the cap, and the UI states "Showing the 100 most valuable of N" — a truncated list must never read as complete.
- **Solana/Tron token USD values are 0** — no per-token rate feed exists on those paths (Reach has the same gap). The UI omits the value rather than printing a misleading `$0.00`.
- **Whale defaults seeded.** The tracker ships with Reach's 20 known whale/exchange wallets (Vitalik, Binance cold/hot, Ethereum Foundation, Alameda, …), restorable any time via **"Load Known Wallets"** (which keeps user-added addresses). Seeding happens only when `ov_tracked_wallets` has *never* been written — unlike Reach, which re-seeds whenever the stored array is empty and therefore makes an empty tracker unreachable. All 20 verified resolving live.

### Reach's endpoint config had rotted — rebuilt

Reach was written against keyless endpoints that have since started demanding auth or 404'ing. Ported verbatim, three of the 20 seeded wallets could never load. Found by testing all 20 against the live chains rather than trusting the port:

| Broken (Reach) | Symptom | Fix |
|---|---|---|
| `rpc.ankr.com/eth` (ETH fallback) | `Unauthorized: You must authenticate` | **All 7 EVM RPCs → `publicnode.com`** (keyless, verified on every chain) |
| `polygon-rpc.com` | `API key disabled, tenant disabled` | ↑ same — Polygon had *no* working path, since its Blockscout host 500s too |
| `bsc` / `polygon` / `avalanche` `.blockscout.com` | 404 / 500 / 404 | Dropped from `BLOCKSCOUT_HOSTS`; those chains go straight to RPC. Only eth/arbitrum/base hosts are healthy. |
| TronGrid, called in parallel | `allowed_rps(1)` — suspends the caller | **Serialised behind a promise chain** (`tronFetch`, ~1.1 s gap). 20 wallets refreshing at once otherwise trip it. |
| `TLyqzVGLV1srkB7dToTAEQgDSFPg9BB3in` ("Justin Sun", Tron) | `A valid account address is required` — fails base58 checksum, invalid even in isolation | Replaced with Binance's Tron cold wallet (`TWd4Wr…`, ~2.01 B TRX) |
- **Not ported:** Reach's drag-to-reorder stat cards / swap-charts gestures.

### The market page (`MoversView`) — 8 tabs

Reach's six CoinMarketCap tabs, ported, **plus two of our own** (Metals, Stocks & ETFs) that Reach
has no equivalent for:

| Tab | Source | Derivation |
|---|---|---|
| Leaderboards | `/api/market/cmc` `coins` | top 30 by market cap |
| Gainers & Losers | ↑ same list | filtered to `volume > 50k`, capped by the pool dropdown (Top 100 / Top 500 / All), split on the timeframe's change field (1h / 24h / 7d / 30d) |
| Trending · Most Visited · Recently Added | CMC `spotlight` | rendered as returned |
| Community Sentiment | ↑ `coins` + Fear & Greed | Most Bullish / Most Bearish = top 15 by `volume × change24h` (a **momentum** score — a big move on real volume outranks a bigger move on none). Per-row bar = `clamp(50 + change24h × 2, 0, 100)`, a per-coin reading, *not* a share of the list |
| **Metals** · **Stocks & ETFs** | `/api/market/movers` | Yahoo `v8/finance/chart` — the same endpoint already used for metals futures also serves equities and ETFs (price + `chartPreviousClose` + volume), so these needed **no new provider and no key** |

**Reach bug fixed in the port.** Reach's Community Sentiment table renders sortable column headers,
but its body maps `list` instead of `sortList(list)` — so clicking "Price" updates sort state and
changes nothing on screen. Here every table routes through the same `sortList`, so the headers work.
Regression-tested in `movers.logic.test.mjs` (`node app/home/wallet/movers.logic.test.mjs`), which
reproduces the original behaviour and asserts ours differs.
- **Footer suppressed** on `/home/wallet` (as on `/home/journal`) — `HomeFooter` returns null; a marketing footer under a full-height dashboard just eats vertical space.
