// Regression — Help panel AI-assistant status must say "Connected" promptly.
//
// User report: bridge demonstrably works (LLM drew on the chart) but the Help
// panel showed "● Waiting for bridge server". Cause: the page only flips
// _agentLinked after its first long-poll RESPONSE, and the server parks every
// poll for 25s — so for the first ~25s the status lies; and the panel never
// re-renders after opening. Fix: the page's first poll after (re)connect sends
// hello:1, which the server answers immediately; the panel live-refreshes the
// status line while open.
//   Run:  node test/regression_agent_help_status.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + name); };

const srv = spawn("node", [path.join(ROOT, "mcp/server.mjs")], {
  env: { ...process.env, OPENVIEW_PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await p.addInitScript(`
  try{
    localStorage.setItem("fv_agent_port", "${PORT}");
    localStorage.setItem("fv_active_symbol", "BTC-USD");
    localStorage.setItem("fv_active_tf", "1d");
  }catch(e){}
`);
await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 });

// wait only until the SERVER sees the page (first poll parked) — NOT 25s
let connected = false;
for (let i = 0; i < 30; i++) {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => ({}));
  if (h.appConnected) { connected = true; break; }
  await new Promise((r) => setTimeout(r, 500));
}
ok(connected, "t1 server sees the page (appConnected) shortly after load");

// t2 — open Help NOW: status must reach "Connected" within a few seconds,
// not after the 25s long-poll hold.
await p.evaluate(() => openHelpPanel());
let status = "";
for (let i = 0; i < 12; i++) {
  status = await p.evaluate(() => {
    const el = document.getElementById("helpAgentStatus");
    return el ? el.textContent.replace("●", "").trim() : "(no status span)";
  });
  if (/^Connected/.test(status)) break;
  await new Promise((r) => setTimeout(r, 500));
}
ok(/^Connected/.test(status), `t2 Help status shows Connected within ~6s (got "${status}")`);

// t3 — kill the server: the OPEN panel's live status must flip away from
// Connected on its own (page retries fail → _agentLinked=false → refresher).
srv.kill();
await new Promise((r) => setTimeout(r, 100));
let after = "";
for (let i = 0; i < 80; i++) {   // poll loop notices on its next cycle (≤~30s worst case)
  after = await p.evaluate(() => {
    const el = document.getElementById("helpAgentStatus");
    return el ? el.textContent.replace("●", "").trim() : "(no status span)";
  });
  if (!/^Connected/.test(after)) break;
  await new Promise((r) => setTimeout(r, 500));
}
ok(!/^Connected/.test(after), `t3 open panel live-updates when server goes away (got "${after}")`);

await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
