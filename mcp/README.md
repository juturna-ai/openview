# OpenView LLM bridge — API + MCP

Lets an LLM (Claude, or anything speaking MCP / HTTP) connect to the chart you
have open in OpenView, **read its data** and **draw on it** — support/resistance
lines, Fibonacci retracements, trend lines, notes. Ask *"where is the
resistance on this chart?"* and Claude can pull the candles, work it out, and
mark the levels on your chart.

**What it can do:** read the active chart (symbol/timeframe/bars/indicators/
alerts/drawings), fetch candles for any symbol+timeframe, add drawings, and
remove drawings **it created**.

**What it can never do:** touch the app's code or settings, create/change
alerts or indicators, delete *your* drawings, or reach anything outside the
chart surface. There is no code-execution path. Everything an LLM draws is
tagged, shows in the object tree, and is one `Ctrl+Z` away from gone.

## Quick start

1. **Start the bridge server** (Node ≥ 18, no npm install needed):

   ```bash
   node mcp/server.mjs
   ```

   It binds `http://127.0.0.1:8787` and also serves the app itself.

2. **Open the chart** at <http://127.0.0.1:8787/> — any localhost-served copy
   (e.g. `./serve.sh`) or a `file://` open works too; the page auto-connects to
   the bridge. On a non-localhost origin add `?agent=1` to the URL.

3. **Add the MCP server to Claude Code:**

   ```bash
   claude mcp add openview -- node /absolute/path/to/openvieweb/mcp/server.mjs --mcp
   ```

   (Claude Desktop: add the same command under `mcpServers` in its config.)
   `--mcp` starts its own HTTP server, or attaches to one already running on
   the port — start order doesn't matter.

4. Ask Claude things like:
   - *"Where are the support and resistance levels on this chart? Draw them."*
   - *"Draw the Fibonacci retracement of the last major swing."*
   - *"Compare the 4h and 1d RSI and give me an overview."*
   - *"Clear everything you drew."*

## MCP tools

| Tool | Does |
|---|---|
| `get_chart` | Active symbol, timeframe, chart type, bar count, last bar, visible range |
| `get_bars` | OHLCV candles (`symbol?`, `timeframe?`, `limit?` ≤ 1500) — defaults to the open chart |
| `get_indicators` | MAs with current values, RSI, added indicators (read-only) |
| `get_alerts` | The symbol's alerts (read-only) |
| `list_drawings` | Every drawing on the chart (`llm:true` = added by the LLM) |
| `add_drawings` | Batch-add drawings: hline, trend, ray, ext, vline, rect, ellipse, fib, fibext, fibfan, fibtime, channel, pitchfork, triangle, text, callout, pricelabel, flag… |
| `remove_drawings` | Remove LLM-added drawings by id, or all of them (`llm_only:true`) |

## REST API (same capabilities, `http://127.0.0.1:8787`)

```
GET    /api/health                         → { ok, appConnected }
GET    /api/chart
GET    /api/bars?symbol=&timeframe=&limit=
GET    /api/indicators
GET    /api/alerts
GET    /api/drawings
POST   /api/drawings                       body: { drawings:[{type, points:[{time,price}], color?, width?, dash?, text?, name?}] }
DELETE /api/drawings/<id>                  (LLM-added drawings only)
DELETE /api/drawings?llm=1                 (clear all LLM-added drawings)
```

Times are UNIX **seconds**. Timeframes: `1m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w 2w 1M 1Y`
(`1M` = month, `1m` = minute). `dash`: 0 solid, 1 dashed, 2 dotted.

## Configuration & security

| Env / setting | Default | Meaning |
|---|---|---|
| `OPENVIEW_PORT` | `8787` | Server port (page side: `localStorage.fv_agent_port`) |
| `OPENVIEW_TOKEN` | *(off)* | Optional shared secret; clients must send `X-OpenView-Token` |

Hardening baked in: binds 127.0.0.1 only; Host-header allowlist (blocks DNS
rebinding); browser callers must have a localhost/`file://` Origin; fixed
command allowlist on both server and page (no eval, no filesystem, no settings
surface); drawing input is validated and capped (≤40 per call, ≤400 total,
text sanitized); request bodies capped at 512 KB; the static file server
refuses dotfiles and `.env*`.

The bridge in the page never runs inside embeds (grid panels / the mobile
WebView) and only ever talks to `127.0.0.1`.
