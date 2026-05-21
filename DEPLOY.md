# Updating production

TribunPlay runs on **Cloudflare Pages** (web), **Workers + Durable Objects** (API), and **D1** (database). The live site rebuilds when you push to the connected branch (typically `main`). The API and database do **not** update automatically — run those steps yourself when needed.

## What updates how

| Layer | Location | Production update |
| --- | --- | --- |
| **Frontend** | `apps/web` | Push to Git → Cloudflare Pages builds and deploys |
| **Backend** | `apps/server` | `npm run deploy:server` (from repo root) |
| **Database** | `apps/server/migrations/` | `wrangler d1 migrations apply` (remote) |

First-time hosting setup (D1 creation, `database_id`, Pages proxy rules) is in [HOSTING_GUIDE.md](./HOSTING_GUIDE.md).

---

## Usual release (frontend only)

```bash
git add .
git commit -m "Your message"
git push origin main
```

Wait for the Pages build in the Cloudflare dashboard, then hard-refresh the site.

---

## Backend changes (`apps/server`)

After merging or committing server code:

```bash
# From repo root (requires wrangler login once)
npm run deploy:server
```

Production **routes** and **vars** are edited in the **Cloudflare Worker dashboard**. `npm run deploy:server` uses `apps/server/wrangler.deploy.jsonc`, which must mirror the dashboard (same routes, vars, `workers_dev`, `preview_urls`, etc.). `keep_vars` keeps extra dashboard-only vars; `--strict` **aborts** deploy if Wrangler still detects a risky config mismatch.

Preview deploy without uploading:

```bash
npm run deploy:check --workspace=apps/server
```

If you change production settings in the dashboard, update `wrangler.deploy.jsonc` to match, or run deploy interactively and accept Wrangler’s offer to sync the file from the dashboard.

Local dev uses `wrangler.jsonc` + `.dev.vars` only (not `wrangler.deploy.jsonc`).

**Secrets** (`TURNSTILE_SECRET_KEY`, `AUTH_TOKEN_SECRET`, …): `wrangler secret put` or dashboard — never in Git.

---

## Database changes (new SQL migrations)

When you add a file under `apps/server/migrations/`:

1. Apply to **remote** D1 **before** deploying worker code that depends on the new schema:

   ```bash
   cd apps/server
   wrangler d1 migrations apply tribunplay-db --remote
   ```

2. Deploy the worker:

   ```bash
   cd ../..
   npm run deploy:server
   ```

Use `--local` instead of `--remote` only for local `wrangler dev`.

---

## Frontend env vars (`VITE_*`)

Build-time variables are **not** in Git. If you change `apps/web/.env.example` or need new keys in production:

1. Cloudflare Pages → your project → **Settings** → **Environment variables**
2. Add or update `VITE_*` values (see `secrets/README.md` and `apps/web/.env.example`)
3. Trigger a new deploy (push an empty commit or **Retry deployment** in the dashboard)

---

## Full-stack change (recommended order)

1. `wrangler d1 migrations apply tribunplay-db --remote` (if migrations changed)
2. `npm run deploy:server` (if `apps/server` or `packages/engine` API contract changed)
3. `git push origin main` (if `apps/web` or shared UI/engine usage changed)

Shared logic in `packages/engine` affects both web and server — deploy the worker when server behavior changes; push to Pages when the web app must pick up engine changes.

---

## Quick check

- Pages: latest deployment succeeded
- Worker: `wrangler deployments list` or Cloudflare Workers dashboard
- Site: create/join a game, WebSocket connects (`/api`, `/ws` proxied to the worker)
