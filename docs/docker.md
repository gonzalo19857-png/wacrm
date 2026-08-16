# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output,
runs as a non-root user) and a `docker-compose.yml` with a single
`app` service. Supabase is external — point the app at your hosted
(or self-hosted) Supabase project via env vars; no database container
is included.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   (publish it elsewhere with `HOST_PORT=8080` in `.env.local`).

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the server listens on _inside_ the container, and `env_file`
> would inject it there — leaving the app on a port the mapping and
> the healthcheck don't target. Compose pins it to 3000 for that
> reason.

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, …) is read at **runtime** from `.env.local` via
  `env_file` and is never baked into the image — safe to change with
  just a container restart.

## Plain Docker (no Compose)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --env-file .env.local -e PORT=3000 -p 3000:3000 wacrm
```

## Deploying on EasyPanel

EasyPanel builds straight from the `Dockerfile` — it doesn't read
`docker-compose.yml` or `.env.local`, so the build-arg / runtime-env
split has to be configured by hand in the app's UI:

1. **Create the app**: New App → Source → your Git repo (or upload) →
   Build method **Dockerfile**, build path `Dockerfile`.
2. **Build Arguments** (the `Build` tab) — these are inlined into the
   client bundle at build time, so set them here, not under
   Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (your EasyPanel domain, e.g.
     `https://crm.example.com`)
   - `NEXT_PUBLIC_APP_LOCALE` (optional, defaults to `en`)
3. **Environment Variables** (the `Environment` tab) — read at
   runtime, never baked into the image:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY`
   - `META_APP_SECRET`
   - any optional vars you need from `.env.local.example`
     (`META_APP_ID`, `AUTOMATION_CRON_SECRET`, `ALLOWED_INVITE_HOSTS`,
     ...)
4. **Port**: the container listens on `3000` (`EXPOSE 3000` /
   `PORT=3000` in the Dockerfile) — set the app's port to `3000` and
   attach your domain with HTTPS through EasyPanel's built-in proxy.
5. **Health check**: the image ships a Docker `HEALTHCHECK` that
   pings `http://localhost:3000/`, so EasyPanel picks up container
   health automatically — no extra config needed.
6. Changing a `NEXT_PUBLIC_*` build argument requires a rebuild
   (redeploy), same as with plain `docker build`. Changing a runtime
   Environment Variable only needs a restart.

Database migrations still aren't run by the container — apply them
against your Supabase project with the Supabase CLI as described in
the README, independent of where the app itself runs.

## Notes

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Received attachments are copied into the `chat-media` Supabase
  Storage bucket, because Meta deletes media roughly 30 days after it
  arrives and the copy is the only thing that outlives that. It grows
  with inbound volume, so it's worth watching your project's storage
  quota. Turn it off per account under Settings → WhatsApp →
  Attachment Storage; attachments received while it's off become
  unviewable once Meta drops them. Files over 16 MB (the bucket's
  limit) are never copied.
- Nothing inside the container is scheduled. If you use automation
  Wait steps or flows, point an external scheduler at
  `GET /api/automations/cron` and `GET /api/flows/cron` on this
  deployment, sending the shared secret in the `x-cron-secret` header
  (`AUTOMATION_CRON_SECRET`, see `.env.local.example`). Both return
  503 until that variable is set.
