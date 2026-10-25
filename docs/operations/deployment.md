# Deployment

Three deployables, all in EU regions:

| Component | What | Where (recommended) | Notes |
|---|---|---|---|
| Database, auth, secrets | Supabase project | `eu-west-1` (Ireland) — already in use | Separate dev and prod projects (decision D2) |
| Web app | `apps/web` (Next.js 16) | Vercel with EU function region, or any Node host | Needs the env vars in `apps/web/.env.example` |
| Voice gateway + worker | `apps/voice-gateway` (Dockerfile) | Fly.io `ams`/`fra`, Railway EU, or a small EU VM | Always-on; WebSockets; 1 shared CPU / 512 MB handles a few dozen concurrent calls |

## 1. Database

Migrations live in `supabase/migrations/` and are the only way the schema changes.

- **With the Supabase CLI** (preferred for production): `supabase link --project-ref <ref>` then `supabase db push`.
- **Through Claude's Supabase connector** (how dev was set up): apply each new migration, then rename the local file
  to the version Supabase recorded (`list_migrations`) so the CLI never re-applies it.
- After every migration: run the security and performance advisors, regenerate types into `packages/db/src/database.types.ts`.

Never apply `supabase/tests/supabase_shim.sql` to a Supabase project.

Auth settings in the Supabase dashboard:
- Disable public sign-ups (accounts are created by invitation).
- Enable TOTP MFA (required for the operator console).
- Configure custom SMTP (your email provider) — Supabase's default sender is not for production.
- Site URL = your web app URL; add `<site>/auth/callback` to redirect URLs.

First operator account: invite yourself in the Supabase dashboard, then insert into `platform_staff`
(`insert into public.platform_staff (user_id, role) values ('<your auth user id>', 'platform_admin');`).

## 2. Web app

```bash
pnpm install --frozen-lockfile
pnpm --filter @vp/web build
```
Environment: see `apps/web/.env.example`. `DATABASE_URL` must use the Supabase **pooler** connection string.
Webhooks to configure:
- Stripe: `<site>/api/stripe/webhook` — events `checkout.session.completed`, `customer.subscription.*`, `invoice.*`.
- Google OAuth redirect URI: `<site>/api/integrations/google/callback`.

## 3. Voice gateway + worker

```bash
docker build -f apps/voice-gateway/Dockerfile -t voice-gateway .
docker run --env-file apps/voice-gateway/.env -p 8080:8080 voice-gateway
```
Environment: `apps/voice-gateway/.env.example`. `PUBLIC_BASE_URL` must be the exact HTTPS URL Twilio calls (signatures
are checked against it). Health check: `GET /health`.

Twilio: set each number's Voice webhook to `POST <gateway>/twilio/voice` and status callback to
`POST <gateway>/twilio/status` (the operator console does this for numbers in your account), and the Edge/region to `ie1`.

Run at least **two instances** once you have paying clients (rolling deploys, one instance failing). Deploys:
the gateway stops accepting new calls on SIGTERM and lets active calls finish for up to 10 minutes — configure the
platform's kill timeout to ≥ 10 minutes.

## 4. Rollback

- **Assistant behaviour**: operator console → client → Assistant → "Switch back to this" on any earlier version (instant).
- **Web app / gateway**: redeploy the previous image/commit. Code is backwards-compatible with the previous migration.
- **Database**: migrations are forward-only. To undo, write a new migration. Point-in-time recovery (Supabase Pro add-on) for disasters — see `backup-restore.md`.

## 5. CI

`.github/workflows/ci.yml` runs typecheck, all unit/integration tests against a fresh Postgres 17 with every migration,
the web build, and a dependency audit, on every push and pull request.
