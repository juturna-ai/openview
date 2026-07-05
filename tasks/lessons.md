# Lessons

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
