# Freeview

A free, self-contained TradingView-style crypto chart. Single HTML file, no server,
no build step, no paywall. Opens straight from disk and pulls live data from
**Coinbase's public API** (no API key required).

Built as a free alternative to TradingView's paywalled "intraday spreads" feature —
specifically to chart the synthetic **NEAR-USD / INJ-USD ratio** that TradingView
locks behind Premium.

---

## Quick start

Just open `index.html` in any modern browser (Chrome / Edge / Firefox):

- Double-click the file, **or**
- Drag it into a browser window, **or**
- Run a tiny static server (optional, not required):
  ```bash
  cd Freeview && python3 -m http.server 8000
  # then visit http://localhost:8000
  ```

No localhost is needed — `file://` works fine because all data is fetched
client-side from Coinbase over HTTPS. The only requirement is an internet connection.

---

## Features

- **Candlestick chart** with live data from Coinbase.
- **6 moving averages** — MA 7, 25, 99, 150, 200, 300 (matches TradingView's
  `7/25/99 MAs` + `SMA 150/200/300`), color-coded with a live top-bar legend:
  - MA7 orange · MA25 red · MA99 green · MA150 cyan · MA200 magenta · MA300 white
- **RSI(14) panel** with a gold smoothing MA, dashed 70/30 bands, 50 midline,
  and green/red overbought/oversold fills — styled to look like TradingView.
- **Drawing toolbar** (left side) — a full canvas-overlay drawing engine:
  - Trend line, ray, extended line, horizontal line/ray, vertical line,
    parallel channel (3-click), rectangle, ellipse.
  - Fibonacci retracement, extension, fan, time zones.
  - Long / short position tools (entry / target / stop with RR).
  - Text, callout, measure tool.
  - Magnet (snap to OHLC), lock, hide-all, remove-all.
  - **Full lifecycle:** click to place (1/2/3-click per tool), hover to highlight,
    click to select, drag handles to resize, drag body to move, `Delete` to remove,
    `Esc` to cancel. **Right-click** any shape for a context menu (settings, clone,
    quick colors, z-order, delete) or right-click empty chart for add-alert /
    add-indicator. **Double-click** a shape to open its settings dialog
    (color, width, line style, fill, text, price label).
  - **Persistence:** drawings are saved to `localStorage` per symbol+timeframe and
    restored automatically.
- **Indicators** (⊞ Indicators button) — add/remove/configure, with searchable menu:
  - Overlays: EMA, SMA, Bollinger Bands, VWAP.
  - Separate panes: Volume, MACD, Stochastic, ATR, Momentum, Williams %R, CCI.
  - Each has a settings gear (periods, colors) and an × to remove; a live legend
    shows active overlays.
- **Price alerts** (🔔 Alert button, or right-click chart) — create alerts above/below
  a price; a dashed line marks each on the chart; when price crosses, you get a
  browser notification + in-app toast + beep. Saved per symbol in `localStorage`.
- **Synthetic spread/ratio charts** — any symbol with a `/` (e.g. `NEAR-USD/INJ-USD`)
  is computed live by aligning both legs' candles and dividing them component-wise.
- **Watchlist** grouped into TradingView's sections (SPREADS / MEME / PRIVACY /
  OMEGA / ALPHA / SECTION 2 / BTC PAIRS / SECTION 3) with real coin logos, live
  prices, absolute + % change; click any row to load it.
- **Timeframes:** 1m, 5m, 15m, 1H, 4H, 6H, 12H, 1D, 1W.
  - Native Coinbase granularities: 1m, 5m, 15m, 1h, 6h, 1d.
  - 4H / 12H / 1W are **aggregated** on the fly from a finer base granularity.
- **Deep history** — paginates Coinbase's 300-bar-per-request limit to pull
  thousands of bars (e.g. ~1,400 daily bars back to 2022; ~10k hourly bars).
- **Bad-print filter** — a Hampel-style neighbor-median wick clamp removes corrupt
  exchange candles (e.g. INJ's bogus 14.75 high on 2025-11-08) that would otherwise
  create fake spikes in ratio charts.

---

## How it works

| Concern | Approach |
|---|---|
| Data source | `https://api.exchange.coinbase.com` — public, keyless |
| Candles | `/products/{PRODUCT}/candles?granularity={sec}` — `[time, low, high, open, close, vol]`, newest-first, ≤300/request |
| Deep history | paginate backward with `start`/`end` windows, dedupe, sort |
| 4H/12H/1W | fetch a finer native granularity, then bucket into target bar size |
| Ratios (A/B) | fetch both legs, align by timestamp, divide OHLC component-wise (`A.high/B.high`, etc.) |
| Prices | per-product `/products/{PRODUCT}/stats` (24h open/last) |
| Charting | [lightweight-charts](https://github.com/tradingview/lightweight-charts) v4.1.3 (loaded from unpkg CDN) |

---

## Known limitations

- **1-minute history** is capped by Coinbase at ~5 days (their limit, not ours).
- **Weekly bars** bucket to the Unix-epoch week (Thursday start); TradingView's
  weekly typically starts Monday, so weekly bucket edges can differ by a few days.
- **Ratio wicks** are approximated (a synthetic ratio has no truly "traded"
  intraday high/low), so they won't be pixel-identical to TradingView.
- Symbols Coinbase doesn't list (e.g. some BTC pairs) show `—` in the watchlist.
- Requires an internet connection; the chart library loads from a CDN.

---

## Configuration

Everything is in `index.html`. To customize:

- **Watchlist** — edit the `GROUPS` array near the top of the `<script>`.
- **Moving averages** — edit the `MAS` array (periods + colors).
- **Timeframes / history depth** — edit the `TF` config (`base`, `bucket`, `pages`).
- **Default symbol/timeframe** — edit `activeSymbol` / `activeTF`.

---

## License

MIT — see `LICENSE`. For personal/educational use. Not financial advice.
Coinbase API usage is subject to Coinbase's terms.
