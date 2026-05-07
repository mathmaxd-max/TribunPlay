# Local secrets (not committed)

Use this folder for **private** copies of keys and env snippets. Only `*.example` files and this README are tracked by Git; anything else you add here stays on your machine.

## Quick setup

1. Copy the template:

   ```bash
   cp secrets/local.env.example secrets/local.env
   ```

2. Edit `secrets/local.env` with your real values (that file is ignored by Git).

3. **Wire them into the apps** (the tools do not read `secrets/` automatically):

   - **Web (Vite):** Copy the `VITE_*` lines into `apps/web/.env.local`, or paste the same vars into Cloudflare Pages → Settings → Environment variables for production builds.
   - **Worker (local `wrangler dev`):** Copy the worker lines into `apps/server/.dev.vars` (see `apps/server/.dev.vars.example`). For production, use Wrangler secrets and dashboard variables instead of committing files.

## Production

Never put production secrets in tracked files. For Cloudflare:

- Pages: environment variables in the project settings (especially `VITE_*`).
- Worker: `wrangler secret put …` and/or Variables in the Worker dashboard.

## References

- `apps/web/.env.example` — web variable names  
- `apps/server/.dev.vars.example` — local Worker variable names  
