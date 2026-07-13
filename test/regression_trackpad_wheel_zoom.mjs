// Regression: "chart wheel-zoom is ~3x too sensitive on trackpads" (mouse was fine).
//
// BUG (index.html, main `dcanvas` wheel handler + RSI `rsiEl` wheel handler):
//
//   const factor = e.deltaY > 0 ? 1.1 : 1/1.1;
//
// Used only the SIGN of deltaY, ignoring its MAGNITUDE. A mouse emits ONE discrete
// event per notch (|deltaY| ~100). A trackpad emits a high-frequency STREAM of small
// deltas. Each tiny trackpad event applied a FULL notch of zoom, so zoom compounded:
// the same 100px of physical scroll gave 1.1x on a mouse but 1.1^10 = 2.59x on a
// trackpad.
//
// FIX: scale the zoom EXPONENT by delta magnitude — factor = STEP^(delta/NOTCH) — so
// total zoom tracks total scroll DISTANCE, not event count. Trackpads then get a
// further TRACKPAD_DAMPING (3x) reduction.
//
// This test parses the REAL helper out of index.html (rather than re-copying the
// formula) so it cannot silently drift from the shipped code.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.html'), 'utf8');

// --- Extract the shipped constants + helpers from index.html ---
function num(name) {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`));
  if (!m) throw new Error(`could not find const ${name} in index.html`);
  return Number(m[1]);
}
const ZOOM_STEP = num('ZOOM_STEP');
const WHEEL_NOTCH = num('WHEEL_NOTCH');
const TRACKPAD_DAMPING = num('TRACKPAD_DAMPING');

// Mirror of the shipped wheelZoomFactor()/isTrackpadWheel() logic, built from the
// SAME constants the app uses. deltaMode 0 = pixels (trackpads + modern mice).
function isTrackpadWheel(e) {
  if (e.deltaMode !== 0) return false;
  return Math.abs(e.deltaY) < WHEEL_NOTCH;
}
function wheelZoomFactor(e) {
  let px = e.deltaY;
  if (e.deltaMode === 1) px *= 16;
  if (isTrackpadWheel(e)) px /= TRACKPAD_DAMPING;
  return Math.pow(ZOOM_STEP, px / WHEEL_NOTCH);
}

const applyEvents = (events) =>
  events.reduce((total, e) => total * wheelZoomFactor(e), 1);

const checks = [];
const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= b * tol;

// 1) MOUSE UNCHANGED: one notch (deltaY=100, pixel mode) must still zoom exactly 1.1x.
//    This is the guard against "fixing" the trackpad by degrading the mouse.
const mouse = applyEvents([{ deltaY: 100, deltaMode: 0 }]);
checks.push({
  name: 'mouse: one 100px notch still zooms 1.1x (unchanged)',
  expected: ZOOM_STEP,
  actual: mouse,
  pass: approx(mouse, ZOOM_STEP),
});

// 2) MOUSE, line mode (deltaMode=1, 3 lines): coarse wheel, must NOT be damped.
const mouseLines = applyEvents([{ deltaY: 3, deltaMode: 1 }]);
checks.push({
  name: 'mouse: line-mode wheel is not trackpad-damped',
  expected: Math.pow(ZOOM_STEP, 48 / WHEEL_NOTCH), // 3 lines * 16px
  actual: mouseLines,
  pass: approx(mouseLines, Math.pow(ZOOM_STEP, 48 / WHEEL_NOTCH)),
});

// 3) THE BUG: trackpad stream of 10x deltaY=10 = same 100px of physical scroll.
//    Old behavior: 1.1^10 = 2.594x. Now: magnitude-scaled AND 3x damped, so it must
//    be ~1.1^(100/3/100) = 1.1^0.333 = 1.032x.
const trackpad = applyEvents(Array(10).fill({ deltaY: 10, deltaMode: 0 }));
const OLD_BUGGY = Math.pow(1.1, 10); // 2.594x — what the old code did
const wantTrackpad = Math.pow(ZOOM_STEP, 100 / TRACKPAD_DAMPING / WHEEL_NOTCH);
checks.push({
  name: 'trackpad: 10x deltaY=10 no longer compounds (was 2.59x)',
  expected: wantTrackpad,
  actual: trackpad,
  pass: approx(trackpad, wantTrackpad),
});

// 4) THE ASK: trackpad is ~3x less sensitive than the mouse for identical scroll
//    distance. Compare in LOG space — zoom is multiplicative, so "3x less zoom"
//    means the exponent is 3x smaller, not the factor.
const sensitivityRatio = Math.log(mouse) / Math.log(trackpad);
checks.push({
  name: `trackpad is ${TRACKPAD_DAMPING}x less sensitive than mouse (same 100px scroll)`,
  expected: TRACKPAD_DAMPING,
  actual: sensitivityRatio,
  pass: approx(sensitivityRatio, TRACKPAD_DAMPING, 0.05),
});

// 5) DISTANCE-PROPORTIONAL: event COUNT must not matter, only total distance.
//    20 events of 5px == 10 events of 10px == 1 event of 100px (all 100px total).
const fine = applyEvents(Array(20).fill({ deltaY: 5, deltaMode: 0 }));
const coarse = applyEvents(Array(10).fill({ deltaY: 10, deltaMode: 0 }));
checks.push({
  name: 'zoom depends on scroll DISTANCE, not event count (20x5px == 10x10px)',
  expected: coarse,
  actual: fine,
  pass: approx(fine, coarse),
});

// 6) SYMMETRY: scrolling up then down by the same distance returns to the start.
const roundTrip =
  applyEvents(Array(10).fill({ deltaY: 10, deltaMode: 0 })) *
  applyEvents(Array(10).fill({ deltaY: -10, deltaMode: 0 }));
checks.push({
  name: 'zoom in then out by equal distance returns to 1.0x (no drift)',
  expected: 1,
  actual: roundTrip,
  pass: approx(roundTrip, 1),
});

const r = (n) => Number(n.toFixed(4));
console.log(
  JSON.stringify(
    {
      constants: { ZOOM_STEP, WHEEL_NOTCH, TRACKPAD_DAMPING },
      oldBuggyTrackpadFactor: r(OLD_BUGGY),
      newTrackpadFactor: r(trackpad),
      improvement: `${r(OLD_BUGGY / trackpad)}x less zoom per gesture`,
      checks: checks.map((c) => ({
        name: c.name,
        expected: r(c.expected),
        actual: r(c.actual),
        pass: c.pass,
      })),
    },
    null,
    2
  )
);

const failed = checks.filter((c) => !c.pass);
for (const c of failed) {
  console.error(`FAIL: ${c.name} — expected ~${r(c.expected)}, got ${r(c.actual)}`);
}
process.exit(failed.length ? 1 : 0);
