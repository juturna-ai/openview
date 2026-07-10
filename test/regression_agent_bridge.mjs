// Regression — LLM agent bridge, end to end with the real page: the app
// connects to mcp/server.mjs, the REST API reads live chart data, add_drawings
// lands in draw.shapes (agent-tagged, undoable), and the LLM can only remove
// its OWN drawings — never the user's.
//   Run:  node test/regression_agent_bridge.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + name); };

const srv = spawn("node", [path.join(ROOT, "mcp/server.mjs")], {
  env: { ...process.env, OPENVIEW_PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.setViewportSize({ width: 1600, height: 900 });
// point the page bridge at the test port + a fast-loading plain symbol
await p.addInitScript(`
  try{
    localStorage.setItem("fv_agent_port", "${PORT}");
    localStorage.setItem("fv_active_symbol", "BTC-USD");
    localStorage.setItem("fv_active_tf", "1d");
  }catch(e){}
`);
await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 });

// wait until the chart has bars AND the bridge has connected
let chart = null;
for (let i = 0; i < 60; i++) {
  try {
    const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
    if (h.appConnected) {
      const r = await fetch(`${BASE}/api/chart`);
      if (r.ok) { const c = await r.json(); if (c.barCount > 0) { chart = c; break; } }
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}

// t1 — chart info round-trips from the real page
ok(!!chart, "t1a page connected + chart loaded (got " + JSON.stringify(chart && { symbol: chart.symbol, barCount: chart.barCount }) + ")");
ok(chart && chart.symbol === "BTC-USD" && chart.timeframe === "1d" && chart.lastBar && chart.lastBar.close > 0,
  "t1b /api/chart reflects the open chart (symbol/tf/last close)");

// t2 — bars of the active chart
const bars = await fetch(`${BASE}/api/bars?limit=50`).then((r) => r.json());
ok(bars.count > 0 && bars.count <= 50 && bars.bars.every((x) => x.time && x.high >= x.low),
  "t2a /api/bars returns valid OHLCV (" + bars.count + " bars)");
const badTf = await fetch(`${BASE}/api/bars?timeframe=7q`);
ok(badTf.status === 502 && /unknown timeframe/.test((await badTf.json()).error || ""), "t2b bad timeframe → validation error");

// t3 — indicators read
const inds = await fetch(`${BASE}/api/indicators`).then((r) => r.json());
ok(Array.isArray(inds.movingAverages) && inds.movingAverages.length > 0 && inds.rsi && inds.rsi.value > 0 && inds.rsi.value < 100,
  "t3 /api/indicators → MAs + RSI values");

// t4 — LLM adds drawings: they land in draw.shapes, agent-tagged, persisted
const t = bars.bars[bars.bars.length - 1].time, price = bars.bars[bars.bars.length - 1].close;
const add = await fetch(`${BASE}/api/drawings`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ drawings: [
    { type: "hline", points: [{ time: t, price: price * 1.05 }], color: "#f23645", name: "Resistance" },
    { type: "fib", points: [{ time: bars.bars[0].time, price: bars.bars[0].low }, { time: t, price }], name: "Swing fib" },
  ] }),
}).then((r) => r.json());
ok(Array.isArray(add.added) && add.added.length === 2, "t4a add_drawings → 2 ids (" + JSON.stringify(add) + ")");
const inPage = await p.evaluate((ids) => {
  const ss = draw.shapes.filter((s) => ids.includes(s.id));
  return { n: ss.length, allAgent: ss.every((s) => s.agent === true), types: ss.map((s) => s.type).sort(), undoable: _undoStack.length > 0 };
}, add.added);
ok(inPage.n === 2 && inPage.allAgent && inPage.types.join() === "fib,hline" && inPage.undoable,
  "t4b shapes in draw.shapes, agent:true, undo snapshot taken");

// t5 — validation: bad type / bad points rejected atomically
const badAdd = await fetch(`${BASE}/api/drawings`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ drawings: [{ type: "hline", points: [{ time: t, price }] }, { type: "evil", points: [] }] }),
});
const badAddBody = await badAdd.json();
const countAfterBad = await p.evaluate(() => draw.shapes.length);
ok(badAdd.status === 502 && /unknown drawing type/.test(badAddBody.error || "") && countAfterBad === 2,
  "t5 invalid batch rejected all-or-nothing (still 2 shapes)");

// t6 — the LLM cannot delete the USER's drawings
const userId = await p.evaluate(() => {
  const s = { id: newId(), type: "hline", pts: [{ time: 1700000000, price: 1 }], style: { ...DEFAULT_STYLE } };
  draw.shapes.push(s); persist(); return s.id;
});
const delUser = await fetch(`${BASE}/api/drawings/${userId}`, { method: "DELETE" }).then((r) => r.json());
const userStill = await p.evaluate((id) => !!draw.shapes.find((s) => s.id === id), userId);
ok(delUser.removed === 0 && userStill, "t6 user drawing survives a delete attempt (removed:0)");

// t7 — clear LLM drawings only
const clr = await fetch(`${BASE}/api/drawings?llm=1`, { method: "DELETE" }).then((r) => r.json());
const left = await p.evaluate(() => ({ total: draw.shapes.length, agent: draw.shapes.filter((s) => s.agent).length }));
ok(clr.removed === 2 && left.agent === 0 && left.total === 1, "t7 llm=1 clears only LLM drawings (user's remains)");

// t8 — alerts read-only endpoint answers
const al = await fetch(`${BASE}/api/alerts`).then((r) => r.json());
ok(al.symbol === "BTC-USD" && Array.isArray(al.alerts), "t8 /api/alerts read-only list");

// t9 — Help panel documents the MCP/API bridge with live "Connected" status
const help = await p.evaluate(() => {
  openHelpPanel();
  const el = document.getElementById("rpBody");
  return el ? el.textContent : "";
});
ok(/AI assistant — MCP \+ API/.test(help) && /● Connected/.test(help) && /node mcp\/server\.mjs/.test(help) && /get_bars/.test(help),
  "t9 Help panel has AI assistant section, status Connected");

await b.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
