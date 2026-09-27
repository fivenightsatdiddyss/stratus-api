#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Railway start script — boots BOTH processes inside this one service:
#
#   1. malq  (temp-mail service)  → internal port 4400, NOT exposed
#   2. node  (stratus api)        → $PORT (injected by Railway), exposed
#
# Why malq exists: raccoongame.com blocked every mail.tm domain, which killed
# the old account-creation flow. malq rotates across ~40 disposable-mail
# providers instead, so a blocked domain just means "try the next one".
#
# The `bun` binary comes from the "bun" npm dependency (see package.json) —
# no system-level install needed.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

echo "[start] launching malq (temp-mail) on internal :4400 ..."
(
  cd malq
  # malq auto-loads .env from its cwd; an empty one means "no proxy, no demo"
  [ -f .env ] || touch .env
  exec ../node_modules/.bin/bun src/main.ts
) &

echo "[start] launching stratus api on :${PORT:-3001} ..."
exec node api.js
