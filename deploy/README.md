# stratus-api — deploy/

Self-contained deployment directory for Railway (or any Nixpacks host).

## What's in here

| Path | What it is |
|---|---|
| `api.js` | The stratus cloud-gaming API (patched: malq-powered account creation) |
| `sites.json` | API keys + limits |
| `public/` | Static assets for the game embed (`/cloud/v1/embed`) |
| `malq/` | Bundled malq — self-hosted disposable-mail service (rotates ~40 providers) |
| `start.sh` | Boots malq (internal :4400) + the API ($PORT) in one service |
| `package.json` | Root manifest; `build` installs malq's deps, `start` runs start.sh |

## Why the patch

raccoongame.com blacklisted every mail.tm domain, so the old account-creation
flow (register → poll → verify) died waiting for an email that never came,
while a global 30-second request timeout killed the connection first.
The fix:

1. Account creation now uses **malq** (`http://127.0.0.1:4400`), which rotates
   across ~40 disposable-mail providers — a blocked domain just means the next
   attempt uses a different one.
2. The raccoongame `sendEmail` response is **actually checked** — a rejected
   domain fails fast and retries with a fresh provider instead of waiting 90s.
3. The global `req.setTimeout(30_000)` was removed (per-session reapers,
   queue-abandon, ping and max-session timeouts still protect the server).
4. On boot, the account pool only fills after malq finishes initializing.

## Railway setup (one-time)

1. New Project → **Deploy from GitHub repo** → pick this repo.
2. Service → **Settings** → **Root Directory**: `deploy`
3. Leave Build Command and Start Command **empty** — Nixpacks auto-detects
   `package.json` and runs `npm install` → `npm run build` (installs malq
   deps via bundled bun) → `npm start` (boots both processes).
4. No environment variables needed. (Optional: `MALQ_HOST` if you ever move
   malq to its own service.)
5. Settings → Networking → **Generate Domain**.

The exposed port is whatever Railway injects as `$PORT`. malq's port 4400 is
internal-only — it is never reachable from the internet.
