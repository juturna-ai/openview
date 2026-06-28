# Full Audit — 2026-06-27

Goal: audit ALL work across sessions (committed waves 1-4 + large uncommitted diff),
fill the empty ARCHITECTURE.md, verify correctness/efficiency/security, then commit.

## Scope of uncommitted diff (vs HEAD, ~1054 insertions)
- CORS proxy + multi-exchange routing (Coinbase/Binance/Bybit/Yahoo)
- Symbol search dialogs (add-symbol, global market search)
- Right price-axis vertical drag (manual scale stretch)
- Crosshair sync hub across panes
- This session: future-region whitespace, tickLabel formatter, single date axis

## Plan
- [ ] 1. Security audit - secrets scan, proxy/XSS/innerHTML, error leakage
- [ ] 2. Correctness audit - coordinate math, null guards, future-region, axis visibility
- [ ] 3. Efficiency audit - redundant fetches, re-renders, hot loops, listeners
- [ ] 4. Best-practices audit - dead code, naming, consistency
- [ ] 5. Verify this session's changes
- [ ] 6. Write ARCHITECTURE.md
- [ ] 7. Fix any P0/P1 findings
- [ ] 8. Commit (only after explicit go)

## Review
(to fill in)

## Review (2026-06-27)

Ran 3 parallel read-only audit subagents (security / correctness / efficiency) over
index.html, then personally verified every finding I acted on by reading the code.

### Fixed (high-confidence, low-risk)
1. Duplicate `window resize` listener (737 + 4337) -> removed 737; boot handler keeps it.
2. `ind.syncSub` leaked: subscribed to sub-chart scale but never unsubscribed in
   removeIndicator -> added unsubscribe (closure held the MAIN chart).
3. Script `syncSub` was an anonymous handler -> stored as sc.syncSub, unsubscribed in removeScript.
4. layoutPanes counted only indicator sub-panes -> now also counts script sub-panes,
   so #subPanes no longer collapses when only a script pane is open.
5. Self-XSS: user symbol echoed into status innerHTML (1163) and fetch error
   into ohlc innerHTML (1200) -> wrapped both in escHtml().
6. futureWhitespace rebuilt ~10x per paint -> memoized by (lastTime/step/length).
   Verified in Node: 10 callers -> 1 build; invalidates on new bar / TF change; cap=2000; daily=120.

### Deferred (documented, not fixed this pass — larger or lower-risk)
- Script sandbox escape via `.constructor.constructor` (P1 by letter): DOCUMENTED design
  decision (user's own code, own machine). True fix = iframe/Worker sandbox = large change.
  Noted in ARCHITECTURE.md security note. Out of scope for a minimal audit pass.
- Perf micro-opts: O(n*k) stoch/willr/cci/stdev, linear scans in updateOhlcLegend/timeAnchors,
  full MA/RSI recompute on every progressive page, search-dialog DOM rebuild per keystroke.
  Real but not user-blocking; left for a dedicated perf pass to avoid risky churn now.
- supertrend data[i-1] at i=0 only when ATR period==1 (degenerate); try/catch already contains it.
- MA series not padded with future whitespace (cosmetic; lines correctly end at last real bar).
- Axis-drag uses arithmetic (not geometric) center in Log mode; minor.

### Docs
- Wrote ARCHITECTURE.md (was empty) — 444 lines, full inside-and-out, verified against code.

### Verification
- node syntax check: PASS (1 script block parses).
- Logic unit-checked in Node: memoized futureWhitespace + escHtml.
- Browser smoke test NOT run (no headless browser; app needs live exchange data). Manual
  browser check still recommended before relying on the listener-leak fixes under add/remove churn.
