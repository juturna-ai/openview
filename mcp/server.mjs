#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  OpenView LLM bridge — local REST API + MCP server (zero dependencies)
//
//  Lets an LLM (Claude via MCP, or anything that can speak HTTP) READ the
//  chart a user has open in OpenView and ADD/REMOVE its own drawings (support/
//  resistance lines, fibs, notes). That is the entire surface: chart data +
//  chart objects. It can NOT modify the app's code, settings, alerts,
//  indicators, watchlists, or storage, and it can only delete drawings it
//  created itself.
//
//  Run modes
//    node mcp/server.mjs          → HTTP server on http://127.0.0.1:8787
//                                   (REST API + page bridge + serves the app)
//    node mcp/server.mjs --mcp    → same, PLUS speaks MCP on stdio. If the
//                                   port is already taken it attaches to the
//                                   existing server instead (so a standalone
//                                   server and several MCP clients coexist).
//
//  Security model (localhost-only, defense in depth)
//    • binds 127.0.0.1 only — never reachable from the network
//    • Host-header allowlist (blocks DNS-rebinding)
//    • Origin allowlist — only localhost / file:// pages may call from a browser
//    • fixed command allowlist on both ends; no eval, no code execution
//    • optional shared secret: set OPENVIEW_TOKEN, send X-OpenView-Token
//    • static file serving refuses dotfiles and anything named .env*
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT  = +(process.env.OPENVIEW_PORT || 8787);
const TOKEN = process.env.OPENVIEW_TOKEN || "";
const MCP_MODE = process.argv.includes("--mcp");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const log = (...a) => console.error("[openview]", ...a);   // stderr only — stdout belongs to MCP

// ── page bridge (long-poll) ─────────────────────────────────────────────────
// The OpenView page POSTs /bridge/poll in a loop: each request carries the
// results of the previous batch and is held open until new commands arrive.
let queue = [];              // commands waiting for the page
const waiters = new Map();   // command id → {resolve, reject, timer}
let parked = null;           // the page's held-open poll response
let lastPollAt = 0;
const QUEUE_MAX = 32, CMD_TIMEOUT_MS = 20000, POLL_HOLD_MS = 25000;

const appConnected = () => parked !== null || Date.now() - lastPollAt < 45000;

function flushParked(commands) {
  if (!parked) return false;
  const { res, timer } = parked;
  parked = null; clearTimeout(timer);
  sendJSON(res, 200, { commands });
  return true;
}

function sendCommand(cmd, params) {
  return new Promise((resolve, reject) => {
    const fail = (code, msg) => { const e = new Error(msg); e.code = code; reject(e); };
    if (!appConnected())
      return fail(503, "OpenView is not connected. Open the chart at http://127.0.0.1:" + PORT + "/ (or any localhost-served copy, or add ?agent=1) and try again.");
    if (queue.length >= QUEUE_MAX) return fail(429, "too many pending commands");
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      waiters.delete(id);
      fail(504, "timed out waiting for the OpenView page to answer");
    }, CMD_TIMEOUT_MS);
    waiters.set(id, { resolve, reject, timer });
    const c = { id, cmd, params: params || {} };
    if (!flushParked([c])) queue.push(c);
  });
}

function handlePoll(req, res, body) {
  lastPollAt = Date.now();
  for (const r of Array.isArray(body?.results) ? body.results : []) {
    const w = waiters.get(r?.id);
    if (!w) continue;
    waiters.delete(r.id); clearTimeout(w.timer);
    if (r.ok) w.resolve(r.result);
    else { const e = new Error(String(r.error || "app error")); e.code = 502; w.reject(e); }
  }
  // A hello poll (page just connected / reconnected) is answered immediately so
  // the page can flip its "Connected" status without waiting out the 25s hold.
  if (body?.hello) return sendJSON(res, 200, { commands: queue.splice(0) });
  if (queue.length) return sendJSON(res, 200, { commands: queue.splice(0) });
  flushParked([]);   // only one poll may park; release a stale one
  const timer = setTimeout(() => flushParked([]), POLL_HOLD_MS);
  parked = { res, timer };
  req.on("close", () => { if (parked && parked.res === res) { clearTimeout(parked.timer); parked = null; } });
}

// ── HTTP plumbing + hardening ───────────────────────────────────────────────
const HOST_RE   = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const ORIGIN_RE = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|null|file:\/\/.*)$/i;

function sendJSON(res, code, obj) {
  if (res.writableEnded) return;
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req, cap = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > cap) { reject(Object.assign(new Error("body too large"), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!n) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("invalid JSON body"), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  try {
    const p = url.pathname, q = url.searchParams;
    if (req.method === "GET" && p === "/api/health")
      return sendJSON(res, 200, { ok: true, appConnected: appConnected(), version: 1 });
    if (req.method === "GET" && p === "/api/chart")
      return sendJSON(res, 200, await sendCommand("chart.info"));
    if (req.method === "GET" && p === "/api/bars")
      return sendJSON(res, 200, await sendCommand("chart.bars", {
        symbol: q.get("symbol") || undefined,
        timeframe: q.get("timeframe") || q.get("tf") || undefined,
        limit: q.get("limit") ? +q.get("limit") : undefined,
      }));
    if (req.method === "GET" && p === "/api/indicators")
      return sendJSON(res, 200, await sendCommand("chart.indicators"));
    if (req.method === "GET" && p === "/api/alerts")
      return sendJSON(res, 200, await sendCommand("alerts.list"));
    if (req.method === "GET" && p === "/api/drawings")
      return sendJSON(res, 200, await sendCommand("draw.list"));
    if (req.method === "POST" && p === "/api/drawings") {
      const body = await readBody(req);
      return sendJSON(res, 200, await sendCommand("draw.add", { drawings: body.drawings }));
    }
    if (req.method === "DELETE" && p.startsWith("/api/drawings")) {
      const id = p.split("/")[3];
      if (id) return sendJSON(res, 200, await sendCommand("draw.remove", { ids: [decodeURIComponent(id)] }));
      if (q.get("llm") === "1") return sendJSON(res, 200, await sendCommand("draw.remove", { llmOnly: true }));
      const body = await readBody(req);
      if (Array.isArray(body.ids) || body.llmOnly != null)
        return sendJSON(res, 200, await sendCommand("draw.remove", { ids: body.ids, llmOnly: !!body.llmOnly }));
      return sendJSON(res, 400, { error: "use /api/drawings/<id>, ?llm=1, or a JSON body {ids?, llmOnly?}" });
    }
    sendJSON(res, 404, { error: "unknown endpoint" });
  } catch (e) {
    sendJSON(res, Number.isInteger(e.code) ? e.code : 500, { error: String(e.message || e) });
  }
}

// Static serving of the app (so http://127.0.0.1:8787/ is same-origin with the
// bridge). GET-only, repo-root jailed, refuses dotfiles and .env* anywhere.
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
function serveStatic(req, res, url) {
  if (req.method !== "GET") return sendJSON(res, 405, { error: "GET only" });
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const abs = path.normalize(path.join(ROOT, rel));
  const parts = abs.split(path.sep);
  if (!abs.startsWith(ROOT + path.sep) ||
      parts.some((s) => s.startsWith(".") || s.toLowerCase().startsWith(".env")))
    return sendJSON(res, 403, { error: "forbidden" });
  fs.readFile(abs, (err, buf) => {
    if (err) return sendJSON(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const origin = req.headers.origin;
    // DNS-rebinding guard: a hostile site pointing its DNS at 127.0.0.1 sends
    // its own hostname here; only true localhost Hosts get through.
    if (!HOST_RE.test(req.headers.host || "")) return sendJSON(res, 403, { error: "forbidden host" });
    if (origin && !ORIGIN_RE.test(origin)) return sendJSON(res, 403, { error: "forbidden origin" });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-OpenView-Token",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }
    const guarded = url.pathname.startsWith("/api/") || url.pathname.startsWith("/bridge/");
    if (guarded && TOKEN && req.headers["x-openview-token"] !== TOKEN)
      return sendJSON(res, 401, { error: "bad or missing X-OpenView-Token" });
    if (req.method === "POST" && url.pathname === "/bridge/poll") {
      try { handlePoll(req, res, await readBody(req)); }
      catch (e) { sendJSON(res, e.code || 400, { error: String(e.message || e) }); }
      return;
    }
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    if (url.pathname.startsWith("/bridge/")) return sendJSON(res, 404, { error: "unknown bridge endpoint" });
    serveStatic(req, res, url);
  });
}

// ── MCP tools (each is a thin wrapper over the REST API) ────────────────────
const TF_KEYS = "1m,5m,15m,30m,1h,2h,4h,6h,12h,1d,1w,2w,1M,1Y";
const TOOLS = [
  {
    name: "get_chart",
    description: "Get the chart the user currently has open in OpenView: symbol, timeframe, chart type, bar count, last bar OHLCV, visible time range and drawing count. Call this first to see what the user is looking at.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_bars",
    description: `Read OHLCV candles from OpenView. With no arguments returns the bars of the chart the user is looking at. Times are UNIX seconds, oldest bar first. Use these to compute support/resistance, trends, fib anchor points etc. symbol accepts what OpenView charts: Coinbase pairs like BTC-USD, BINANCE:BTCUSDT, BYBIT:BTCUSDT (.P for perps), YF:AAPL, or a spread A/B (e.g. NEAR-USD/INJ-USD). timeframe is one of: ${TF_KEYS} (1M = 1 month, 1m = 1 minute — case matters).`,
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "defaults to the open chart's symbol" },
        timeframe: { type: "string", description: `one of ${TF_KEYS}; defaults to the open chart's timeframe` },
        limit: { type: "number", description: "max bars to return, newest kept (default 300, max 1500)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_indicators",
    description: "Read the indicators active on the user's chart: each moving average (kind/period/current value), current RSI, and the list of added indicators with their parameters. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_alerts",
    description: "Read the user's price alerts for the active symbol. Read-only — alerts cannot be created or changed through this bridge.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_drawings",
    description: "List every drawing on the user's chart (trend lines, fibs, zones…). Drawings with llm:true were added through this bridge and are the only ones remove_drawings may delete.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_drawings",
    description: `Draw on the user's chart (they see it instantly; Ctrl+Z undoes it). Each drawing: {type, points:[{time,price}…], color?, width?, dash?, text?, name?}. time = UNIX seconds of a bar (from get_bars), price = level. Types and required point counts:
• hline (1) horizontal level — ideal for support/resistance; • vline (1); • text / callout / pricelabel / flag (1, text/callout need "text")
• trend (2), ray (2), ext (2, extends both ways), rect (2 opposite corners — supply/demand zone), ellipse (2), arrow (2)
• fib (2) Fibonacci retracement: point 1 = swing start, point 2 = swing end; fibext (2); fibfan (2); fibtime (2); gannfan (2)
• channel (3), pitchfork (3), fibtbext (3), triangle (3)
color = hex like #f23645, width = 1–4, dash: 0 solid | 1 dashed | 2 dotted. Give each drawing a short "name" (e.g. "Resistance 0.42") so it reads well in the user's object tree.`,
    inputSchema: {
      type: "object",
      properties: {
        drawings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              points: { type: "array", items: { type: "object", properties: { time: { type: "number" }, price: { type: "number" } }, required: ["time", "price"] } },
              color: { type: "string" }, width: { type: "number" }, dash: { type: "number" },
              text: { type: "string" }, name: { type: "string" },
            },
            required: ["type", "points"],
          },
        },
      },
      required: ["drawings"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_drawings",
    description: "Remove drawings previously added through this bridge (llm:true only — the user's own drawings can never be deleted). Pass ids from list_drawings/add_drawings, or llm_only:true to clear everything the LLM drew on this symbol.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        llm_only: { type: "boolean", description: "true = remove ALL LLM-added drawings" },
      },
      additionalProperties: false,
    },
  },
];

async function api(method, pathname, body) {
  const r = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(TOKEN ? { "X-OpenView-Token": TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({ error: "bad response from bridge server" }));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};

function callTool(name, a = {}) {
  switch (name) {
    case "get_chart":       return api("GET", "/api/chart");
    case "get_bars":        return api("GET", "/api/bars" + qs({ symbol: a.symbol, timeframe: a.timeframe, limit: a.limit }));
    case "get_indicators":  return api("GET", "/api/indicators");
    case "get_alerts":      return api("GET", "/api/alerts");
    case "list_drawings":   return api("GET", "/api/drawings");
    case "add_drawings":    return api("POST", "/api/drawings", { drawings: a.drawings });
    case "remove_drawings": return api("DELETE", "/api/drawings", { ids: a.ids, llmOnly: !!a.llm_only });
    default: throw new Error("unknown tool: " + name);
  }
}

function startMcp() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (line) => {
    line = line.trim();
    if (!line) return;
    let m; try { m = JSON.parse(line); } catch { return; }
    const { id, method, params } = m;
    try {
      if (method === "initialize")
        return send({ jsonrpc: "2.0", id, result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "openview", version: "1.0.0" },
        } });
      if (typeof method === "string" && method.startsWith("notifications/")) return;
      if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
      if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      if (method === "tools/call") {
        try {
          const out = await callTool(params?.name, params?.arguments || {});
          return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }] } });
        } catch (e) {
          return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(e.message || e) }], isError: true } });
        }
      }
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } });
    } catch (e) {
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e.message || e) } });
    }
  });
  rl.on("close", () => process.exit(0));
}

// ── boot ────────────────────────────────────────────────────────────────────
const server = createServer();
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && MCP_MODE) {
    log(`port ${PORT} already in use — attaching to the existing OpenView bridge server`);
    return; // MCP tools go over HTTP to the running instance
  }
  log("server error:", e.message);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  log(`OpenView LLM bridge on http://127.0.0.1:${PORT}  (app: open that URL; API under /api/*)`);
});
if (MCP_MODE) startMcp();
