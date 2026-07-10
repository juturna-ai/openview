// Regression — duplicate drawing ids after reload. `uid` restarts at 1 on
// every page load while persisted shapes keep their saved ids, so the first
// new drawing in a session got id "s1" — colliding with a persisted "s1"
// (seen live: an MCP demo hline and a user trend line shared id s1, making
// id-based ops ambiguous). newId() must never return an id an existing shape
// already holds.
//   Run:  node test/regression_shape_id_collision.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8796;
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + name); };

const srv = spawn("node", [path.join(ROOT, "mcp/server.mjs")], {
  env: { ...process.env, OPENVIEW_PORT: String(PORT) }, stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 500));

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
// Simulate a prior session: persisted drawings s1..s3 for the active symbol.
await p.addInitScript(`
  try{
    localStorage.setItem("fv_active_symbol", "BTC-USD");
    localStorage.setItem("fv_active_tf", "1d");
    localStorage.setItem("fv_draw_BTC-USD", JSON.stringify([
      { id:"s1", type:"hline", pts:[{time:1700000000, price:1}], style:{color:"#2962ff", width:2, dash:0} },
      { id:"s2", type:"hline", pts:[{time:1700000000, price:2}], style:{color:"#2962ff", width:2, dash:0} },
      { id:"s3", type:"trend", pts:[{time:1700000000, price:1},{time:1700086400, price:2}], style:{color:"#2962ff", width:2, dash:0} },
    ]));
  }catch(e){}
`);
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
await p.waitForFunction(() => window.draw && draw.shapes.length === 3, null, { timeout: 15000 });

// t1 — a fresh newId() must not collide with any persisted shape id
const r1 = await p.evaluate(() => {
  const id = newId();
  return { id, dup: draw.shapes.some((s) => s.id === id) };
});
ok(!r1.dup, `t1 newId() avoids persisted ids (got "${r1.id}")`);

// t2 — end to end: shapes added in this session (agent path uses newId too)
// produce unique ids across the whole shape list
const r2 = await p.evaluate(async () => {
  await agentExec("draw.add", { drawings: [
    { type: "hline", points: [{ time: 1700000000, price: 3 }] },
    { type: "hline", points: [{ time: 1700000000, price: 4 }] },
  ] });
  const ids = draw.shapes.map((s) => s.id);
  return { ids, unique: new Set(ids).size === ids.length };
});
ok(r2.unique, "t2 all shape ids unique after adding in a fresh session (" + r2.ids.join(",") + ")");

await b.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
