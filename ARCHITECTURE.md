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

| Key | `base` (sec fetched) | `bucket` (sec per bar) | `pages` |
|---|---|---|---|
| `1m` | 60 | 60 | 26 |
| `5m` | 300 | 300 | 36 |
| `15m` | 900 | 900 | 18 |
| `30m` | 900 | 1800 | 18 |
| `1h` | 3600 | 3600 | 36 |
| `4h` | 3600 | 14400 | 36 |
| `6h` | 21600 | 21600 | 20 |
| `12h` | 21600 | 43200 | 20 |
| `1d` | 86400 | 86400 | 9 |
| `1w` | 86400 | 604800 | 9 |

`base` is the native granularity actually fetched from the exchange. When `bucket > base` (4h, 12h, 1w, 30m), `aggregate()` rolls up the base bars into fixed epoch-aligned buckets.

### Per-exchange page fetchers

Each normalises its exchange's payload to the common shape `{time(sec), low, high, open, close, volume}`:

- **`fetchPageCoinbase(product, g, span, end)`** — Coinbase `[time, low, high, open, close, vol]` array, up to 300 bars, times already in seconds.
- **`fetchPageBinance(rest, g, span, end, isPerp)`** — Binance kline array, up to 1000 bars, `openTime` converted from ms to seconds.
- **`fetchPageBybit(rest, g, span, end, isPerp)`** — Bybit v5 `result.list`, up to 1000 bars, `start` converted from ms to seconds.
- **`fetchPageYahoo(sym, g, end)`** — Yahoo v8 chart endpoint; returns the full series in one call (no pagination cursor); null gaps (holidays/halts) are skipped. Routed through `proxyJSON`.

`fetchPage(leg, g, span, end)` dispatches to the correct fetcher based on `resolveLeg`.

### Progressive loader — `fetchKlinesProgressive`

Paginates backward through history, calling `onPage(barsSoFar)` after each page so the chart can paint immediately while history deepens. Each page's oldest timestamp drives the next `end` parameter. A page shorter than 66% of the maximum page size signals the start of history; the loop stops early. Coinbase caps at 300 bars/page; Binance/Bybit at 1000.

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

### Yahoo Finance stats

`fetchStatsYahoo(sym)` fetches a 5-day 1d chart and reads `meta.regularMarketPrice` (last) and `meta.chartPreviousClose` (open) for watchlist price display.

---

## 4. Rendering Layer

### Chart instances

| Instance | Element | Purpose |
|---|---|---|
| `chart` | `#chart` | Main candle chart + 6 MAs + aux series |
| `rsiChart` | `#rsi` | RSI(14) panel (fixed, always visible) |
| `ind.subChart` (per indicator) | `.subpane` in `#subPanes` | Dynamically created for sub-pane indicators |
| `sc.subChart` (per script) | `.subpane` in `#subPanes` | Dynamically created for script sub-pane plots |

All chart instances share `common` options (dark background, grid, `PRICE_AXIS_W = 72` px right-axis gutter, `handleScroll:false`, `handleScale:false` — pan/zoom are handled manually on the overlay canvas).

### Main chart series

- `candle` — `CandlestickSeries`; the canonical OHLC and coordinate anchor. `autoscaleInfoProvider` pins the scale to `manualPriceRange` when set.
- `maSeries[0..5]` — six `LineSeries` for MA 7/25/99/150/200/300 (orange/red/green/cyan/magenta/white).
- `aux{}` — lazily created auxiliary series keyed by chart type (`line`, `area`, `baseline`, `bars`) for non-candle chart styles.

### `renderData(data, keepView)`

The central paint function. Called on each progressive page and at completion:

1. Sets `lastData = data`.
2. Calls `applyChartType(data)` — routes into the active chart style (see below).
3. Calls `redraw()` to repaint the drawing overlay.
4. Computes and sets six MA series via `smaSeries`.
5. Computes RSI(14) and its 14-bar MA via `rsiSeries` / `maOfSeries`; re-keys both onto the full `data` timeline using `fullSeries` (whitespace padding) so RSI bars stay index-aligned with candles in the synced logical range.
6. Calls `renderAllIndicators()`, `renderAllScripts()`, `checkAlerts()`.
7. If `!keepView && _autoSnap`, snaps the visible range to the latest ~420 bars plus ~35% future whitespace.
8. Calls `alignPriceAxes()` (deferred via `setTimeout(0)`) to equalise right-axis gutter widths.

### Chart types — `applyChartType`

Controlled by `chartType` (string: `candles|hollow|heikin|bars|line|area|baseline`). `setChartType(t)` updates it and calls `applyChartType`.

- **candles** — `candle` visible with raw data.
- **hollow** — `candle` visible with `hollowData(data)` (per-bar color `rgba(0,0,0,0)` body when close≥open; colored by close vs previous close).
- **heikin** — `candle` visible with `heikinAshi(data)` transform.
- **bars / line / area / baseline** — `candle` hidden (but still set with data so coordinates remain valid); the corresponding `auxSeries(type)` series is shown. Baseline anchors at `data[0].close`.

Scale modes (0 Normal / 1 Log / 2 Percent) are set via `setScaleMode(m)` which calls `chart.priceScale("right").applyOptions({mode:m})`.

### Future whitespace — `futureWhitespace` / `withFuture` / `FUTURE_DAYS`

`FUTURE_DAYS = 120`. Every series (candles, MAs, RSI, indicators, scripts) is padded with ~4 months of whitespace bars (`{time}` only — no OHLC) so the time scale, grid lines, date-axis labels, and drawings extend past the last real bar. `futureWhitespace(data)` is memoized on `(lastBarTime, tfStep, barCount)` to avoid reallocating the same tail array on every render call. `withFuture(data, pts)` appends the tail.

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
| `wheel` | Zoom anchored under cursor (keep bar under pointer fixed); shift+wheel = horizontal pan |
| `contextmenu` | Shape context menu, alert context menu, or chart context menu |
| `keydown` | Esc: cancel / deselect; Delete/Backspace: delete selected shape |

**Auto-snap** (`_autoSnap`): during a fresh progressive load, `renderData` snaps the view to the latest bars on each page. The first real pan or zoom gesture calls `stopAutoSnap()` to stop re-snapping.

### Drawing tool list

The `TOOLS` array and `CLICKS` map define every tool. Tool names from Wave 1/2 (original) and Wave 3 (added):

- **Lines:** Trend, Ray, Extended, Info (stats), Trend Angle, Horizontal Line, Horizontal Ray, Vertical Line, Cross Line
- **Channels/Fans:** Parallel Channel (3-click), Andrews Pitchfork (3-click), Gann Fan
- **Shapes:** Rectangle, Ellipse, Triangle (3-click), Arrow, Polyline/Path (multi-click, dblclick to finish), Brush (freehand)
- **Fibonacci:** Fib Retracement, Fib Extension, Trend-Based Fib Extension (3-click), Fib Fan, Fib Time Zone
- **Position:** Long Position, Short Position
- **Ranges:** Price Range, Date Range, Date & Price Range, Measure
- **Annotations:** Text (prompt), Callout/Note (prompt), Flag, Price Label
- **Toggles:** Magnet (snap to OHLC), Lock All, Hide All
- **Action:** Remove All (confirm dialog)

`CLICKS[type]` gives the number of anchor points required: 1 = single-click finish, 2 = drag or two-click, 3 = three anchor points, 0 = freehand / unbounded (polyline/brush).

### Shape rendering — `drawShape` / `redraw`

`redraw()` clears the canvas, draws alert dashed lines (`drawAlertLines`), then draws every shape in `draw.shapes` order plus any pending shape. `drawShape(s, selected, hovered)` dispatches on `s.type` to per-type drawing functions. Selected shapes show white circle handles at each `pt`. The `extend(x1,y1,x2,y2,W,H)` helper clips a ray to the canvas boundary.

### Settings dialog — `openSettings`

Double-clicking a shape (or choosing "Settings…" from the context menu) opens `#settingsDlg` with live-preview fields: line color (color picker), width (range), line style (solid/dashed/dotted), fill opacity (for rect/ellipse/position), text (for text/callout), and "show price label" checkbox.

### Manual pan and price-axis drag

Because the overlay canvas captures all events, LWC's built-in pan/zoom is disabled. Pan is reimplemented in `startPan` / `doPan`: horizontal drag moves the time scale by `(dx / barSpacing)` bars; vertical drag shifts `scaleMargins` as a balanced pair (top += f, bottom -= f) so the candle band translates without rescaling.

Right-axis vertical drag (`startAxisDrag` / `doAxisDrag`) computes an exponential zoom factor from drag distance and sets `manualPriceRange`, which is honoured by `candle.autoscaleInfoProvider`. Double-clicking the axis calls `resetPriceScale()` (clears `manualPriceRange`, restores auto-scale).

---

## 6. Indicators

### Catalog — `IND_CATALOG`

~50 entries, each with `{type, name, cat, pane, params}`. Categories: Moving Averages, Oscillators, Trend, Volatility, Volume, Bill Williams, Other. `pane` is either `"main"` (overlay) or `"sub"` (separate pane below `#subPanes`).

### Lifecycle

- **`addIndicator(type)`** — creates an entry in `indicators[]`, calls `buildIndicatorSeries` then `renderIndicator`.
- **`buildIndicatorSeries(ind)`** — for `pane:"main"` indicators, creates series on `chart`. For `pane:"sub"`, creates a `<div class="subpane">` in `#subPanes`, creates a new `LightweightCharts` instance, wires bidirectional time-scale sync with `chart`, calls `registerPane`, and wraps each series with `alignSubSeries`.
- **`renderIndicator(ind)`** — calls the appropriate `*Calc` function(s) and calls `series.setData(...)`. Dispatches on `ind.type` via a large switch.
- **`removeIndicator(id)`** — unsubscribes time-scale sync handlers, removes series, removes the sub-chart and its DOM element, calls `unregisterPane`.
- **`renderAllIndicators()`** — calls `renderIndicator` on every active indicator; called from `renderData`.

### Plot descriptors — `plotSpec(ind)`

Returns an array of `{k, color, w}` plot specs (kind `"line"` or `"hist"`) so `buildIndicatorSeries` stays data-driven. Multi-series indicators (MACD = hist + 2 lines, BB/KC/Donchian = 3 lines, ADX = 3 lines, Ichimoku = 5 lines) each return the appropriate array.

### Timeline alignment — `fullSeries` / `alignSubSeries`

Calc helpers return shorter arrays (they start at `i = period - 1`). A sub-pane synced by logical bar index would shift left if its series is shorter than the main chart's. `fullSeries(data, pts)` re-keys the output onto the complete `data` timeline, inserting whitespace `{time}` entries for warmup bars, then appends `futureWhitespace(data)` so sub-pane indicators reach the future region in lockstep. `alignSubSeries(series)` wraps a series's `setData` to call `fullSeries` automatically.

### Hardwired indicators

Six MAs (7/25/99/150/200/300) are rendered directly in `renderData` via `smaSeries`. RSI(14) is rendered via `rsiSeries` / `maOfSeries` into the always-visible `#rsiWrap` pane (not part of `indicators[]`).

### Indicator settings — `openIndicatorSettings`

Dynamically builds a dialog from `Object.entries(ind.params)`. Number inputs use `step=1` or `step=0.01` (for `FLOAT_PARAMS`). Color inputs recolor the series in real time. Source inputs (`src`) use a `<select>` over `SRC_OPTS = ["close","open","high","low","hl2","hlc3","ohlc4"]`.

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
  active, _last
}
```

`source` and `target` are keys from `ALERT_SOURCES`: `"price"`, `"ma7"` through `"ma300"`, `"rsi"`. `op` is one of `crossing | crossUp | crossDown | gt | lt`.

### Evaluation — `checkAlerts` / `alertTriggered`

Called from `renderData` on every paint. `sourceValue(key)` computes the current value of each source from `lastData`. `alertTargetValue(a)` resolves the RHS (either a fixed number or a source value). `alertTriggered` uses `a._last` (the previous LHS-minus-RHS difference) to detect sign changes for crossing ops; level ops (`gt`/`lt`) fire on current state. Expired alerts are deactivated; "once" alerts deactivate after firing.

### Firing — `fireAlert`

On trigger: browser `Notification` (if permission granted and `notify.browser`), in-app toast div with 6-second auto-remove (if `notify.popup`), Web Audio API beep at 880 Hz (if `notify.sound`). Email requires a backend and is silently no-op.

### Visual — `drawAlertLines`

For `price`-vs-`value` alerts, `redraw` calls `drawAlertLines()` which draws a dashed horizontal line at `priceToY(a.value)`, a right-edge price pill, and (on hover) a pill with a vector trash icon. `alertHitboxes[]` stores `{id, y, trash}` for mouse hit-testing (`alertHit`, `alertTrashHit`).

---

## 9. Persistence (localStorage)

| Key pattern | What is stored | Written by | Read by |
|---|---|---|---|
| `fv_watchlist` | `GROUPS[]` — array of `{name, symbols[], collapsed?}` | `saveGroups()` | `loadGroups()` at boot |
| `fv_draw_<symbol>_<tf>` | `draw.shapes[]` — array of `{id, type, pts, style, text?}` | `persist()` | `loadPersisted()` on symbol/TF change and at boot |
| `fv_scripts_<symbol>` | `[{name, code}]` — user script name and source | `saveScripts()` | `loadScripts()` on symbol change and at boot |
| `fv_alerts_<symbol>` | `[{id, source, op, target, value, trigger, expiry, message, notify, active}]` | `saveAlerts()` | `loadAlerts()` on symbol change and at boot |

Drawings are keyed per **symbol + timeframe** so a BTC-USD 1D layout does not clobber BTC-USD 1H. Scripts and alerts are keyed per **symbol only**.

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

`loadChart(symbol, tf, keepView)` uses a `loadToken` counter so stale in-flight progressive callbacks are discarded when the user switches symbol or TF before the previous load completes.

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
