# LLM API + MCP for OpenView charts (read data + manage drawings only)

Goal: let Claude (or any MCP client) connect to a RUNNING OpenView chart, read
its data (symbol/tf/bars/indicators/alerts/drawings) and add/remove drawings
(lines, fibs, notes) so it can answer "where is support/resistance" and mark it
on the chart. Explicitly NOT allowed: anything beyond chart data + chart
objects — no code execution, no app/settings mutation, no file access.

Design (no build step, zero npm deps):
- `mcp/server.mjs` — single-file Node server, bound to 127.0.0.1 only:
  - long-poll bridge the page connects to (`POST /bridge/poll`)
  - REST API: `/api/health`, `/api/chart`, `/api/bars`, `/api/indicators`,
    `/api/alerts`, `/api/drawings` (GET/POST/DELETE)
  - MCP stdio server (`--mcp`) — hand-rolled newline-delimited JSON-RPC; tools
    call the REST API so `--mcp` attaches to an already-running server
  - static-serves the repo so `http://127.0.0.1:8787/` opens the app same-origin
- `index.html` — agent bridge (~150 lines at end of script): long-poll loop +
  fixed command map (`chart.info`, `chart.bars`, `chart.indicators`,
  `alerts.list`, `draw.list`, `draw.add`, `draw.remove`). LLM drawings get
  `agent:true` and go through snapshotDraw/persist/redraw (undoable, object
  tree, persisted). Bridge runs only on localhost / `?agent=1` / `fv_agent=1`,
  never in embeds.

Security hardening (user requirement: nothing malicious possible):
- server binds 127.0.0.1; Host-header check (anti DNS-rebinding) + Origin
  check (only localhost/file origins may call the API from a browser)
- fixed command allowlist on BOTH sides; no eval / code-exec / fs / settings
  surface; alerts+indicators are READ-only; only drawings are writable
- drawing input validated: type ∈ CLICKS allowlist, numeric points, text/name
  length-capped + <> stripped, ≤40 shapes/call, ≤400 agent shapes total
- 512KB body cap, JSON-only, bounded command queue; static server has
  path-traversal guard and never serves dotfiles/.env*
- optional shared secret via OPENVIEW_TOKEN (X-OpenView-Token header)

## Plan
- [x] Read ARCHITECTURE.md + index.html internals (draw model, CLICKS, fetchTfBars, persist/redraw/snapshotDraw)
- [x] `mcp/server.mjs`: bridge + REST + MCP stdio + static serving + hardening
- [x] `index.html`: agent bridge (gated, embed-excluded, validated)
- [x] `mcp/README.md`: setup (claude mcp add …), tools, REST examples, security notes
- [x] Tests: `test/regression_agent_bridge.mjs` (playwright round-trip) + `test/regression_agent_mcp.mjs` (stdio handshake + hardening checks)
- [x] ARCHITECTURE.md: new §14 "LLM Bridge — API + MCP"
- [x] Self-review; no commit (awaiting go-ahead)

## Review
- `test/regression_agent_mcp.mjs`: 14/14 — MCP initialize/tools/list/call, clean
  "not connected" error, spoofed-Host 403, hostile-Origin 403, .env*/dotfile 403,
  path-traversal 403, fake-page long-poll round trip, page error → 502.
- `test/regression_agent_bridge.mjs`: 11/11 — real page (BTC-USD 1d) served by
  the bridge server itself; REST reads live chart/bars/indicators/alerts;
  add_drawings lands in draw.shapes agent-tagged + undoable; invalid batch is
  all-or-nothing; DELETE cannot touch user drawings (removed:0); ?llm=1 clears
  only LLM shapes.
- Malicious-use review: server binds 127.0.0.1; Host+Origin allowlists; fixed
  command map both ends (no eval/fs/settings surface); alerts+indicators
  read-only; LLM can only delete its own drawings; drawing input validated and
  capped (type ∈ CLICKS, numeric points, text/name sanitized, ≤40/call, ≤400
  total); 512KB body cap; optional OPENVIEW_TOKEN shared secret.
- NOT committed, NOT deployed — awaiting go-ahead. index.html + ARCHITECTURE.md
  already carried unrelated uncommitted edits from a previous session; untouched.

## Follow-up fix (user report): Help panel said "Waiting for bridge server" while connected
- Cause: `_agentLinked` only flips after the first long-poll RESPONSE, which the
  server parks for 25s; panel also never refreshed after opening.
- Fix: first poll after (re)connect sends `hello:1` → server answers immediately;
  Help status span (`#helpAgentStatus`) live-refreshes every 2s while open.
- Proof: `test/regression_agent_help_status.mjs` — failed pre-fix (t2 "Waiting"),
  now 3/3 incl. live flip to "Waiting" when the server is killed. Other two agent
  suites re-run green. Lesson added to tasks/lessons.md.

## Follow-up fix: duplicate shape ids across sessions
- `uid` restarts at 1 per load while persisted shapes keep saved ids → first new
  drawing of a session collided with persisted "s1" (seen live during MCP demo).
- Fix: `newId()` skips ids already held by a shape in `draw.shapes`.
- Proof: `test/regression_shape_id_collision.mjs` (failed pre-fix: dup "s1" and
  a 5-shape list with two duplicate pairs; now 2/2). Bridge suite re-run 12/12.
