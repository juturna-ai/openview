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
