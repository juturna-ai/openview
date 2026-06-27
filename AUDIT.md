# Freeview vs TradingView — Full Feature Audit & Roadmap

_Audit date: 2026-06-27. Engine decision: stay on **Lightweight Charts** (Apache-2.0, freely redistributable). TradingView's official Charting Library is free-to-apply but **not** redistributable, so it cannot back a "free for anyone" app — every advanced feature below is rebuilt on Lightweight Charts._

This document maps TradingView (TV) feature-by-feature against Freeview as of commit `e1e00b6`, grades the gap, and lays out the build order. Research is grounded in TV's official support docs + Lightweight Charts docs (see commit message / session research, not memory).

---

## 0. Honest scope statement

TradingView is a ~15-year product with 100+ drawing tools, 100+ built-in indicators, Pine Script, server-side alerts, a strategy tester, replay, screeners, multi-chart layouts, and global multi-asset data. An "exact replica" is hundreds of features. This audit prioritizes **the highest-value gaps a single free web app can credibly close** and sequences them into shippable waves. Some TV features are intentionally **out of scope** because they require a paid backend, real-money brokerage, or licensed data (noted in §7).

---

## 1. Chart engine & data

| Capability | TV | Freeview today | Gap |
|---|---|---|---|
| Charting engine | Proprietary Charting Library | Lightweight Charts 4.1.3 (standalone UMD) | OK (deliberate) |
| Data source | Global multi-asset (paid feeds) | Coinbase public API (crypto only, no key) | Crypto-only — acceptable for free |
| Multi-pane | Native | 2 stacked chart instances, time-synced | v5 has native panes; our stacking works |
| Series primitives (pinned drawings) | N/A (their own) | **Overlay canvas** (separate `#draw`) | v4.1+ primitives could replace overlay later |
| Progressive history load | yes | yes (paginated Coinbase) | OK |
| Spread/ratio symbols (`A/B`) | yes (`+ - * /`) | yes (`A/B` division) | partial — only `/` |

**Lightweight Charts facts that shape the build (v4.1.3 we're on):**
- 6 series types only: Candlestick, Bar, Line, Area, Baseline, Histogram. **No native Heikin Ashi / Renko / Kagi / P&F** → must transform data ourselves and feed a candle/line series.
- v4 = **one pane per chart**; multi-pane = stacked instances (what we do). v5.0+ adds native `addPane`/`moveToPane` but switching is a bigger migration — defer.
- `PriceScaleMode`: Normal=0, Logarithmic=1, Percentage=2, IndexedTo100=3. Set via `rightPriceScale.mode`. `invertScale:true` also available. **Log scale is a one-line option we don't expose yet.**
- Plugin/primitive API exists since v4.1 (`ISeriesPrimitive`) — a future path to retire the overlay canvas, not needed now.

---

## 2. Indicators

TV ships ~120 built-ins. Freeview has **11** (`IND_CATALOG`): EMA, SMA, BB, VWAP, Volume, MACD, Stochastic, ATR, Momentum, Williams %R, CCI — plus hardwired 6 MAs + RSI panel.

### Have (11 + RSI + 6 MA)
EMA, SMA, BB, VWAP, Volume, MACD, Stochastic(k/d), ATR, Momentum, Williams %R, CCI, RSI(+MA), MA7/25/99/150/200/300.

### Highest-value missing (Wave 1 targets — formulas captured in research)
**Moving averages:** WMA, HMA, VWMA, DEMA, TEMA, ALMA, SMMA/RMA, LSMA.
**Oscillators:** Stochastic RSI, ROC, Awesome Oscillator (AO), Ultimate Oscillator, TRIX, CMO, PPO, DPO, Connors RSI, Fisher Transform.
**Trend:** ADX/DMI, Aroon (+Aroon Oscillator), Supertrend, Parabolic SAR, **Ichimoku Cloud**, Vortex, Linear Regression Channel.
**Volatility:** Keltner Channels, Donchian Channels, Standard Deviation, Historical Volatility, Choppiness Index, BB %B, BB Width.
**Volume:** OBV, MFI, Accumulation/Distribution, Chaikin Money Flow, Chaikin Oscillator, Ease of Movement, Force Index, PVT, Volume Oscillator.
**Bill Williams:** Alligator, Fractals, Gator, Accelerator Oscillator.
**Other:** Pivot Points Standard, Envelopes, Balance of Power, Coppock Curve, KST.

### Key default params & formulas (verified, for implementation)
- RSI len14 (Wilder RMA); MACD 12/26/9 (EMA); Stoch k14 smoothK3 d3; CCI len20 const0.015; Williams %R len14; AO 5/34 of (H+L)/2; UO 7/14/28 weighted 4/2/1.
- ADX: Wilder-smoothed +DM/-DM/TR → +DI/-DI → DX → ADX(14). PSAR start0.02 step0.02 max0.20. Supertrend ATR10 factor3. Ichimoku 9/26/52, displacement 26.
- BB 20 SMA ±2σ; Keltner EMA20 ±2·ATR10; Donchian HH/LL 20; ATR RMA14.
- OBV cumulative ±vol; MFI 14 (volume-weighted RSI); ADL cumulative MF-volume; CMF 20; VWAP = Σ(hlc3·vol)/Σvol.
- HMA = WMA(2·WMA(n/2) − WMA(n), √n); DEMA = 2·EMA − EMA(EMA); TEMA = 3·EMA − 3·EMA² + EMA³; ALMA Gaussian offset0.85 sigma6; RMA recursive 1/n.

### Gaps in current indicator UX
- No way to add an MA/EMA with a chosen **source** (close/open/hl2/hlc3/ohlc4) — TV exposes source on everything.
- No per-indicator "settings → Inputs vs Style" split, no plot-level color/visibility.
- No indicator-on-indicator (RSI-of-RSI etc.) — TV `input.source()`. Out of scope for Wave 1.
- No favorites, no indicator templates.

---

## 3. Chart types

| Type | TV | Freeview | Notes |
|---|---|---|---|
| Candles | ✅ | ✅ | — |
| Bars (OHLC) | ✅ | ❌ | LWC `addBarSeries` |
| Hollow Candles | ✅ | ❌ | candle color by close vs prev close |
| Line / Line+markers / Step | ✅ | ❌ | `addLineSeries` (+`lineType`) |
| Area / HLC Area | ✅ | ❌ | `addAreaSeries` |
| Baseline | ✅ | ❌ | `addBaselineSeries` |
| Columns / Hi-Lo | ✅ | ❌ | histogram / custom |
| **Heikin Ashi** | ✅ | ❌ | transform → candle series. HA-Close=(O+H+L+C)/4; HA-Open=(prevHAO+prevHAC)/2; HA-High=max(H,HAO,HAC); HA-Low=min(L,HAO,HAC) |
| Renko | ✅ | ❌ | brick build from close; brick=fixed/ATR14/%; reversal=2·brick. Time-axis breaks (LWC needs synthetic times) |
| Line Break | ✅ | ❌ | n-line break |
| Kagi | ✅ | ❌ | reversal% close-based; thin/thick on shoulder/waist |
| Point & Figure | ✅ | ❌ | X/O cols, box+3-box reversal |

**Scale modes:** TV offers Regular / Percent / Indexed-to-100 / **Log** + invert. Freeview exposes none. Log scale is the single highest-value quick win (one option).

**Wave 2 target:** chart-type dropdown with Candles, Hollow, Bars, Line, Area, Baseline, **Heikin Ashi** (all native/transform). Renko/Kagi/PnF/LineBreak are harder (synthetic time axis) → Wave 2b/later. Plus **log/percent scale toggle** and a settings gear for grid/crosshair/theme.

---

## 4. Drawing tools

TV groups: Cursors, Lines (13), Fibonacci (11), Gann (4), Pitchfork (4), Patterns (13 incl. Elliott), Projection/Forecast (9), Brushes/Shapes (12), Annotation (12), Icons. ~80 tools.

### Have (~20)
Crosshair, Trend, Ray, Extended, HLine, HRay, VLine, Parallel Channel, Rect, Ellipse, Fib Retracement, Fib Extension, Fib Fan, Fib Time Zone, Long/Short Position, Text, Callout, Measure, + Magnet/Lock/Hide/Clear toggles.

### Highest-value missing
- **Lines:** Info Line (auto stats), Trend Angle, Cross Line, Flat Top/Bottom, Disjoint Channel, Regression Trend.
- **Fibonacci:** Trend-Based Fib Extension (3pt), Fib Channel, Fib Circles, Fib Speed/Resistance Fan, Pitchfan.
- **Gann:** Gann Box, Gann Fan, Gann Square.
- **Pitchfork:** Andrews, Schiff, Modified Schiff, Inside (all 3-point, share median+parallels geometry).
- **Shapes:** Arrow, Rotated Rectangle, Triangle, Polyline, Path, Arc, Brush, Highlighter.
- **Annotation:** Price Label, Flag, Note, Anchored Text, Arrow marks, Emoji/Sticker, Signpost, Image.
- **Projection/Measure:** Price Range, Date Range, Date & Price Range, Bars Pattern, Forecast, Ghost Feed, Projection.
- **Patterns:** XABCD, ABCD, Head & Shoulders, Triangle, Three Drives, Elliott waves (5 variants).

### Wave 3 targets (best effort/value ratio on the existing canvas engine)
Arrow, Triangle, Polyline/Path, Brush, Price Range, Date Range, Date&Price Range, Trend-Based Fib Extension, Gann Fan, Andrews Pitchfork (+Schiff variants), Flag/Price Label/Emoji, Cross Line, Info Line, Trend Angle. These reuse the `{time,price}`-points + `drawShape` model already in place.

---

## 5. Chart features / platform

| Feature | TV | Freeview | Wave |
|---|---|---|---|
| Timeframes | s/m/h/D/W/M (+ticks) | 1m–1w (10) | add seconds + 1M month, 2h/3h/8h/3D — easy |
| Watchlist (groups, drag, persist) | ✅ | ✅ (strong) | — |
| Symbol search (type-to-search, Ctrl/Cmd+K) | ✅ | ❌ (watchlist-click only) | Wave 5: add search over Coinbase products |
| Alerts (price) | ✅ server-side | ✅ client-side crossing | OK for free; no server push |
| Indicator/drawing alerts | ✅ | ❌ | later |
| Bar Replay | ✅ (paid) | ❌ | Wave 5/6 — feasible client-side, high value |
| Log/percent scale | ✅ | ❌ | Wave 2 |
| Chart settings (theme/grid/crosshair) | ✅ | partial (fixed dark) | Wave 2 |
| Multi-chart layouts (1–16) | ✅ | ❌ (1 chart) | big; defer |
| Compare/overlay symbol | ✅ | ❌ | Wave 5/6 |
| Save/load layouts | ✅ cloud | drawings+watchlist in localStorage | partial |
| Object tree | ✅ | ❌ | nice-to-have |
| Data window / OHLC legend | ✅ | partial (OHLC legend) | improve in Wave 2 |
| Go to date (Alt+G) | ✅ | ❌ | easy, Wave 5 |
| Screenshot | ✅ | ❌ | easy (canvas export), Wave 5 |
| Hotkeys | ✅ many | few (Esc/Del) | grow over waves |
| Pine Script (custom indicators) | ✅ (huge) | ❌ | **Wave 4** — mini expression engine |

---

## 6. Pine Script (Wave 4 — scoped)

Real Pine Script is a typed, versioned DSL with a compiler, `request.security`, strategies, and a backtester — not replicable in full in a free single-file app. **Scope a "Freeview Script":** a sandboxed JS-ish/formula mini-language that exposes `close/open/high/low/hl2/hlc3/volume` series + a `ta.*` library (sma, ema, rsi, atr, stdev, highest, lowest, crossover…) and a `plot()` call, evaluated per-bar to produce overlay or sub-pane series. Covers the 80% case (custom indicators) without claiming full Pine/strategies.

---

## 7. Out of scope (require paid backend / licensed data / brokerage)

Server-side alerts & webhooks; real brokerage/paper trading; licensed stock/forex/futures real-time data; cloud account sync; social publishing/ideas feed; full Pine strategy tester with order sim; screener over all global markets; news/earnings/dividends panels. These are noted honestly rather than faked.

---

## 8. Build order (waves)

1. **Wave 1 — Indicators.** Add ~35 indicators with proper settings (length + source + color), grouped catalog with categories & search. Biggest credibility win per hour.
2. **Wave 2 — Chart types + scale.** Chart-type dropdown (Candles/Hollow/Bars/Line/Area/Baseline/Heikin Ashi) + log/percent scale toggle + basic chart settings (theme/grid/crosshair). Renko/Kagi/PnF later.
3. **Wave 3 — Drawing tools.** Arrow, Triangle, Polyline/Path, Brush, Price/Date/Date&Price Range, Trend-Based Fib Ext, Gann Fan, Andrews/Schiff Pitchfork, Flag/Price-Label/Emoji, Cross/Info/Trend-Angle lines.
4. **Wave 4 — Freeview Script.** Mini custom-indicator language with `ta.*` + `plot()`.
5. **Wave 5 — Platform polish.** Symbol search (Ctrl+K), go-to-date, screenshot, more timeframes, compare symbol, bar replay.

Each wave: implement → smoke-test in browser → commit. Keep the single-file, no-build architecture.
