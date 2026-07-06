# Task: TradingView-parity settings dialogs for drawing tools

## Goal
Give every drawing tool a TradingView-style tabbed settings dialog. Fib retracement gets
full 3-tab parity (matching the screenshots); all other tools get Style/Coordinates/Visibility.

## Done
- [x] Per-shape fib config (`s.fib` via `defaultFibConfig()`), lazy migration via `getFib(s)`.
- [x] `FIB_DEFAULT_LEVELS` — 24 TV default levels + colors (red/blue/gray/orange/indigo).
- [x] `drawFib` renders from per-shape config (levels, colors, extend, reverse, one-color, trend line).
- [x] `openFibSettings` — tabbed Style/Coordinates/Visibility dialog:
      Style = trend line, levels line, extend, reverse, label toggles, 24 level rows, use-one-color.
      Coordinates = price/bar for #1 & #2. Visibility = 8 time scopes.
- [x] Generic `openSettings` rewritten as tabbed dialog for all other tools, driven by `TOOL_CAPS`.
      Style caps: fill, text (+color+size), arrow toggle, extend (trend), label toggle.
      Coordinates tab = per-point price/bar rows. Visibility tab = 8 scopes on `style.visibility`.
- [x] Wired new render props: `fillColor`, `textColor`, `fontSize`, `extend` (trend), `arrow`.
- [x] Tests: test/regression_fib_settings.mjs (PASS), test/regression_tool_settings.mjs (PASS).
- [x] ARCHITECTURE.md updated.

## Review
- Fib defaults match screenshots (24 distinct levels; screenshots visually show ~26 but the
  distinct TV default set is 24). Values/colors verified in test.
- Backward compatible: shapes saved before this change get defaults on first render/edit.
- "Value is null" pageerrors on reload are PRE-EXISTING (a plain trend line reproduces them);
  unrelated to this change. Filtered in the regression tests.

## Not done / follow-ups
- Fib Fan / Fib Time Zone still render from hardcoded inline arrays (no per-shape level editor yet).
- Trend-Based Fib Extension (fibtbext) uses the generic dialog, not a fib level editor.
- `extend` only wired into the plain trend line render (info/angle omit it to avoid a no-op control).
