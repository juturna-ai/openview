import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Docs — MCP + API — Openview',
  description:
    'Connect an LLM to your Openview chart over MCP or the local REST API: read candles, indicators, alerts and drawings, and let it draw support/resistance, fibs and notes.',
};

// Docs page for the LLM bridge (MCP + REST API). This is the canonical, full version of what
// used to live in the in-chart Help panel — the panel now links here instead. Source of truth
// for the bridge itself is mcp/README.md; keep the two in sync when the API changes.
export default function DocsPage() {
  return (
    <div className="ov-container ov-prose ov-docs">
      <h2 className="ov-h2">Docs — AI assistant (MCP + API)</h2>
      <p>
        Connect an LLM (Claude, or anything that speaks MCP or plain HTTP) to the chart you have
        open in Openview. It can <strong>read</strong> the candles, indicators, alerts and
        drawings, and <strong>draw on the chart</strong> — support/resistance lines, Fibonacci
        retracements, trend lines, notes. Ask <em>“where is the resistance on this chart?”</em> and
        it pulls the bars, works it out, and marks the levels.
      </p>

      <h3 className="ov-h3">What it can and cannot do</h3>
      <p>
        <strong>Can:</strong> read the active chart (symbol, timeframe, bars, indicators, alerts,
        drawings), fetch candles for any symbol and timeframe, add drawings, and remove drawings{' '}
        <em>it created</em>.
      </p>
      <p>
        <strong>Can never:</strong> touch the app’s code or settings, create or change alerts or
        indicators, delete <em>your</em> drawings, or reach anything outside the chart surface.
        There is no code-execution path. Everything an LLM draws is tagged, shows up in the object
        tree, and is one <code className="ov-code">Ctrl+Z</code> away from gone.
      </p>

      <h3 className="ov-h3">Quick start</h3>
      <ol className="ov-steps">
        <li>
          <strong>Start the bridge server</strong> — Node ≥ 18, nothing to install:
          <pre className="ov-pre">
            <code>node mcp/server.mjs</code>
          </pre>
          It binds <code className="ov-code">http://127.0.0.1:8787</code> and also serves the app
          itself.
        </li>
        <li>
          <strong>Open the chart</strong> at <code className="ov-code">http://127.0.0.1:8787/</code>{' '}
          — any localhost-served copy or a <code className="ov-code">file://</code> open works too;
          the page auto-connects to the bridge. On a non-localhost origin, add{' '}
          <code className="ov-code">?agent=1</code> to the URL.
        </li>
        <li>
          <strong>Add the MCP server to Claude Code:</strong>
          <pre className="ov-pre">
            <code>
              claude mcp add openview -- node /absolute/path/to/openvieweb/mcp/server.mjs --mcp
            </code>
          </pre>
          Claude Desktop: add the same command under <code className="ov-code">mcpServers</code> in
          its config. <code className="ov-code">--mcp</code> starts its own HTTP server, or attaches
          to one already running on the port — start order doesn’t matter.
        </li>
        <li>
          <strong>Ask for something:</strong> “Where are the support and resistance levels on this
          chart? Draw them.” · “Draw the Fibonacci retracement of the last major swing.” · “Compare
          the 4h and 1d RSI and give me an overview.” · “Clear everything you drew.”
        </li>
      </ol>

      <h3 className="ov-h3">MCP tools</h3>
      <div className="ov-table-wrap">
        <table className="ov-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code className="ov-code">get_chart</code>
              </td>
              <td>Active symbol, timeframe, chart type, bar count, last bar, visible range</td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">get_bars</code>
              </td>
              <td>
                OHLCV candles (<code className="ov-code">symbol?</code>,{' '}
                <code className="ov-code">timeframe?</code>, <code className="ov-code">limit?</code>{' '}
                ≤ 1500) — defaults to the open chart
              </td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">get_indicators</code>
              </td>
              <td>Moving averages with current values, RSI, added indicators (read-only)</td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">get_alerts</code>
              </td>
              <td>The symbol’s alerts (read-only)</td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">list_drawings</code>
              </td>
              <td>
                Every drawing on the chart (<code className="ov-code">llm:true</code> = added by the
                LLM)
              </td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">add_drawings</code>
              </td>
              <td>
                Batch-add drawings: hline, trend, ray, ext, vline, rect, ellipse, fib, fibext,
                fibfan, fibtime, channel, pitchfork, triangle, text, callout, pricelabel, flag…
              </td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">remove_drawings</code>
              </td>
              <td>
                Remove LLM-added drawings by id, or all of them (
                <code className="ov-code">llm_only:true</code>)
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="ov-h3">REST API</h3>
      <p>
        Same capabilities, served from <code className="ov-code">http://127.0.0.1:8787</code>.
      </p>
      <pre className="ov-pre">
        <code>{`GET    /api/health                         → { ok, appConnected }
GET    /api/chart
GET    /api/bars?symbol=&timeframe=&limit=
GET    /api/indicators
GET    /api/alerts
GET    /api/drawings
POST   /api/drawings                       body: { drawings:[{type, points:[{time,price}], color?, width?, dash?, text?, name?}] }
DELETE /api/drawings/<id>                  (LLM-added drawings only)
DELETE /api/drawings?llm=1                 (clear all LLM-added drawings)`}</code>
      </pre>
      <p>
        Times are UNIX <strong>seconds</strong>. Timeframes:{' '}
        <code className="ov-code">1m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w 2w 1M 1Y</code> (
        <code className="ov-code">1M</code> = month, <code className="ov-code">1m</code> = minute).{' '}
        <code className="ov-code">dash</code>: 0 solid, 1 dashed, 2 dotted.
      </p>

      <h3 className="ov-h3">Configuration</h3>
      <div className="ov-table-wrap">
        <table className="ov-table">
          <thead>
            <tr>
              <th>Env / setting</th>
              <th>Default</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code className="ov-code">OPENVIEW_PORT</code>
              </td>
              <td>
                <code className="ov-code">8787</code>
              </td>
              <td>
                Server port (page side: <code className="ov-code">localStorage.fv_agent_port</code>)
              </td>
            </tr>
            <tr>
              <td>
                <code className="ov-code">OPENVIEW_TOKEN</code>
              </td>
              <td>
                <em>off</em>
              </td>
              <td>
                Optional shared secret; clients must send{' '}
                <code className="ov-code">X-OpenView-Token</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="ov-h3">Security</h3>
      <p>
        The bridge is local-only by design: it binds <code className="ov-code">127.0.0.1</code>{' '}
        only, enforces a Host-header allowlist (blocking DNS rebinding), and requires browser
        callers to have a localhost or <code className="ov-code">file://</code> origin — hostile
        origins are rejected.
      </p>
      <p>
        Both the server and the page enforce a fixed command allowlist: no eval, no filesystem
        access, no settings surface. Drawing input is validated and capped (≤ 40 per call, ≤ 400
        total, text sanitized), request bodies are capped at 512 KB, and the static file server
        refuses dotfiles and <code className="ov-code">.env*</code>. The bridge in the page never
        runs inside embeds (grid panels or the mobile WebView) and only ever talks to{' '}
        <code className="ov-code">127.0.0.1</code>.
      </p>

      <p>
        <a href="/index.html">Open the live charts →</a>
      </p>
    </div>
  );
}
