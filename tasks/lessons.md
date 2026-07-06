# Lessons

## A single uncaught error inside Lightweight Charts' rAF render freezes the WHOLE chart
The "Value is null" warning I'd previously dismissed as benign was NOT benign. When LWC
throws inside its `requestAnimationFrame` render callback (here: the line renderer, during
rapid successive `setData` calls), the exception unwinds the render loop and **the chart's
render + time-scale pipeline stops permanently** — candles never paint, and `setVisibleLogicalRange`
/ `scrollToPosition` / `applyOptions({barSpacing})` all become silent no-ops (the "bouncing"
/ frozen-zoom symptom). Lesson: treat ANY error thrown from inside a charting library's
internals as potentially fatal to that widget. Don't wave off intermittent console errors as
cosmetic — reproduce, get the stack (`pageerror.stack`, not just `.message`), and eliminate
the source. A window-level `error` handler that `preventDefault()`s it does NOT recover the
aborted render loop.

## Don't repaint a multi-series chart on every progressive page — coalesce
The spread loader painted once per page from BOTH legs (~16 full re-renders of candle + 6 MAs
+ RSI series in a burst). That render thrash is what triggered the LWC race above. For a
spread, paint ONCE after both legs finish. General rule: if N series each `setData` inside a
loop that runs M times during load, that's N×M renders competing with the rAF loop — batch to
one render of the final data. The single paint also fixed a stale/inflated bar count.

The SAME bug bit the single-symbol loader (the "timeframe switch is slow / sometimes doesn't
change" report). A Coinbase intraday TF streams ~168 pages (50k bars ÷ 300/page) and painted
on EVERY page → ~168 full re-renders, freezing the UI ~20s and tripping the null-race that
wedges the chart (so the switch looked like it did nothing). Fix: paint the FIRST page only
(instant switch + snap to latest), then paint once more at the end with the complete series;
history deepens in between without repainting. A per-frame rAF-coalesced repaint was NOT
enough — even ~1 repaint/frame across many frames still tripped the race intermittently
(3–5 crashes/switch). Two paints total (first + final) is what reliably eliminated it.

## series.update(time) throws + truncates data if the series has a trailing whitespace tail
We pad every series with ~4 months of future whitespace (`withFuture`). Calling
`series.update({time: lastRealBar})` then targets an INTERIOR point (the tail is later), which
throws `Cannot update oldest data` in LWC — and the failed update wipes the whitespace tail as
a side effect, scrolling the view into an empty future region and blanking the candles. If a
series carries a future tail, don't `update()` it per-tick; re-`setData` the whole array
(here: route the live tick through `applyChartType`).

## Clamp zoom span so candles never go sub-pixel
Manual wheel/keyboard zoom had no upper bound on visible-bar span. Zooming all the way out on
a 1385-bar series gave barSpacing ~1.5px → candles vanished into the grid and the chart looked
"empty/broken". Clamp span to `[8, width/4.5]` bars so bar spacing floors at ~3–4px like TradingView.

## Lightweight-charts sub-pane subscriptions must be paired with unsubscribe
When you `subscribeVisibleLogicalRangeChange` to sync a sub-chart with the main chart,
STORE the handler and unsubscribe it in the remove path. Anonymous inline handlers
leak; closures over the main `chart` keep firing on a torn-down pane. Pattern: store
both directions (`syncMain`, `syncSub`) on the object, unsubscribe both on removal.

## Pane bookkeeping must cover EVERY pane producer
`layoutPanes`/visibility logic counted only `indicators` and forgot `scripts`. When two
features both create sub-panes, any count/iteration over panes must include both, or one
feature's panes vanish when the other's are removed. Check `allPaneCharts()` is the single
source of truth.

## Escape ALL dynamic data going into innerHTML, even "self" data
Symbol names and error messages came from user-controlled localStorage and were echoed
into innerHTML unescaped (self-XSS, persistent if watchlist state is shared/imported).
`escHtml` already existed — the fix was just to use it. Rule: never interpolate a
non-numeric runtime value into innerHTML without escHtml().

## Memoize fan-out helpers called once per series per paint
`futureWhitespace` was rebuilt ~10x per render (once per series). Cache by a cheap key
(lastTime/step/length) — the tail only changes when those change. Return the cached array
only when callers don't mutate it (here, `concat` doesn't).

## Audit with subagents, but verify findings before acting
Ran 3 parallel Explore agents. They were largely accurate but had a few false alarms
(e.g. "lastData polluted by whitespace" — it wasn't). Always re-read the exact lines
before editing; line numbers and conclusions can drift.

## Grid "too dense" had TWO independent sources — don't stop at the first fix
User reported dense vertical gridlines. First I disabled LWC's built-in vertLines on the
main chart, then on RSI, then on indicator sub-panes — each a separate config. But the
intraday wall (visible on 4h/6h/12h, NOT daily) came from a THIRD source: `drawSessionBreaks`
drawing one faint line per day, only active on intraday TFs. The "only below daily" symptom
was the tell — it pointed at the intraday-only code path, not the shared grid config.
Rule: when a visual artifact has a timeframe/zoom-dependent symptom, trace WHICH code path
is TF-gated. And a canvas overlay can re-add "grid" lines the chart-lib config can't control
— grep every function that strokes full-height verticals (drawTimeGrid, drawSessionBreaks,
vline shapes), not just the LWC `grid:` options.

## Overlay grid only covers the main chart, not sub-panes
`#draw` canvas is scoped to `#chartWrap`. Anything drawn there (drawTimeGrid) never appears
on RSI/indicator sub-panes — those are separate LWC charts with their own `grid:` config.
So a "disable the grid" change needs edits in 3 places: `common`, and both sub-chart configs.

## "Timeframe switch is slow / shows a different chart" was network + cache + a stale-render race
Three compounding causes, fixed together:
1. **No series cache** — every TF switch re-fetched from scratch. Added a bounded LRU
   `_seriesCache` keyed `"SYM|tf"`; `loadChart` paints it synchronously on switch, so any
   revisited TF is instant (~1 ms), then refreshes in the background.
2. **Eager full-depth fetch → HTTP 429** — `fetchKlinesProgressive` fetched ~334 Coinbase
   pages per switch (for the 50k-bar ceiling), which throttled to 429 and looked like a hang.
   Capped the eager load to `initialPages` (~2000 output bars) and let `loadOlderHistory`
   deepen on scroll-back. Also retry 429/5xx in `fetchPageCoinbase` so the first page lands.
3. **Stale-render glitch** — `loadOlderHistory` had no `loadToken` guard, so a scroll-back
   fetch in flight during a TF switch could prepend the OLD TF's bars onto the new chart.
   Captured `startToken=loadToken` and abort if it changes mid-fetch.

Rule: for "feature X is slow" on a network-backed chart, FIRST check page-count-per-action
and the network tab for 429s before assuming render cost — and instrument first-paint latency
vs. network round-trips separately. Any async path that mutates shared `lastData`/repaints
(not just the main loader) needs the same `loadToken` staleness guard.
