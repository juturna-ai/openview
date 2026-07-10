// Regression — LLM bridge server (mcp/server.mjs): MCP stdio handshake, REST
// API, security hardening, and the page long-poll protocol (with a fake page).
// No browser needed.
//   Run:  node test/regression_agent_mcp.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + name); };

const srv = spawn("node", [path.join(ROOT, "mcp/server.mjs"), "--mcp"], {
  env: { ...process.env, OPENVIEW_PORT: String(PORT) },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = [];
let buf = "";
srv.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
});
const send = (m) => srv.stdin.write(JSON.stringify(m) + "\n");
const waitReply = (id, ms = 5000) => new Promise((res, rej) => {
  const t0 = Date.now();
  (function poll() {
    const m = lines.find((l) => l.id === id);
    if (m) return res(m);
    if (Date.now() - t0 > ms) return rej(new Error("no reply for id " + id));
    setTimeout(poll, 25);
  })();
});
await new Promise((r) => setTimeout(r, 500)); // server boot

// ── t1: MCP handshake + tools/list ──
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
const init = await waitReply(1);
ok(init.result?.serverInfo?.name === "openview", "t1a initialize → serverInfo.name openview");
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const tl = await waitReply(2);
const names = (tl.result?.tools || []).map((t) => t.name);
ok(names.length === 7 && ["get_chart", "get_bars", "get_indicators", "get_alerts", "list_drawings", "add_drawings", "remove_drawings"].every((n) => names.includes(n)),
  "t1b tools/list → the 7 chart tools (got: " + names.join(",") + ")");

// ── t2: tools/call without an app → clean isError, not a crash ──
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_chart", arguments: {} } });
const nc = await waitReply(3);
ok(nc.result?.isError === true && /not connected/i.test(nc.result?.content?.[0]?.text || ""),
  "t2 get_chart with no app → isError 'not connected'");

// ── t3: hardening — Host allowlist (DNS rebinding), Origin allowlist, dotfiles, traversal ──
const rawGet = (p, headers = {}) => new Promise((res) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path: p, headers }, (r) => res(r.statusCode));
  req.on("error", () => res(-1)); req.end();
});
ok(await rawGet("/api/health", { Host: "evil.com" }) === 403, "t3a spoofed Host → 403");
ok(await rawGet("/api/health", { Origin: "https://evil.com" }) === 403, "t3b hostile Origin → 403");
ok(await rawGet("/api/health", { Origin: "http://localhost:5501" }) === 200, "t3c localhost Origin → 200");
ok(await rawGet("/.env") === 403 && await rawGet("/.env.local") === 403, "t3d /.env* → 403");
ok(await rawGet("/..%2f..%2fetc%2fpasswd") === 403, "t3e path traversal → 403");
ok(await rawGet("/api/nope") === 404, "t3f unknown api → 404");

// ── t4: fake page long-poll round-trip (REST → command → result → REST reply) ──
const fakePage = (async () => {
  let results = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${BASE}/bridge/poll`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    }).then((r) => r.json());
    results = (r.commands || []).map((c) => {
      if (c.cmd === "chart.info") return { id: c.id, ok: true, result: { symbol: "TEST-USD", timeframe: "1d", barCount: 42 } };
      if (c.cmd === "draw.add") return { id: c.id, ok: true, result: { added: ["s1"] } };
      return { id: c.id, ok: false, error: "unknown command: " + c.cmd };
    });
  }
})();
await new Promise((r) => setTimeout(r, 200)); // let the fake page park its poll
const chart = await fetch(`${BASE}/api/chart`).then((r) => r.json());
ok(chart.symbol === "TEST-USD" && chart.barCount === 42, "t4a GET /api/chart round-trips through the page");
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
ok(health.appConnected === true, "t4b health reports appConnected");
const add = await fetch(`${BASE}/api/drawings`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ drawings: [{ type: "hline", points: [{ time: 1, price: 2 }] }] }),
}).then((r) => r.json());
ok(Array.isArray(add.added) && add.added[0] === "s1", "t4c POST /api/drawings round-trips");
// page-side error surfaces as a 502 with the message
const bad = await fetch(`${BASE}/api/alerts`);
const badBody = await bad.json();
ok(bad.status === 502 && /unknown command/.test(badBody.error || ""), "t4d page error → 502 with message");

// ── t5: MCP tools/call goes through the same pipe ──
send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_chart", arguments: {} } });
const tc = await waitReply(4);
const tcBody = JSON.parse(tc.result?.content?.[0]?.text || "{}");
ok(!tc.result?.isError && tcBody.symbol === "TEST-USD", "t5 MCP get_chart → page data");

await fakePage.catch(() => {});
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
