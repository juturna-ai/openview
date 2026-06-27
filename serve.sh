#!/usr/bin/env bash
# Always serve THIS project (Freeview) on a fixed port, from this directory —
# no matter where you run it from. Open http://localhost:5501 in the browser.
# Using one stable URL keeps your saved drawings (localStorage is per-origin).
cd "$(dirname "$0")" || exit 1
PORT="${1:-5501}"
echo "Serving Freeview at http://localhost:${PORT}  (Ctrl+C to stop)"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
