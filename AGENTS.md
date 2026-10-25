# Working rules for this repository

Read this first in every session. Architecture: `docs/adr/`. Current state: `docs/STATUS.md`.

## Non-negotiables

- **Never claim something works without evidence** (a passing test, a tool result, a deployment log). Use the statuses
  in `docs/STATUS.md` and update that file when status changes.
- **Schema changes only through new files in `supabase/migrations/`.** Never edit an applied migration. When applying
  through the Supabase connector, rename the file to the version Supabase records (`list_migrations`) and regenerate
  `packages/db/src/database.types.ts`. Every new
  table: RLS enabled, explicit grants, `organization_id` + composite FKs for tenant data, tests in `packages/db/test`.
- **Server code bypasses RLS** — every query in `packages/server` and `apps/web/lib/db.ts` callers must be scoped by an
  organization id resolved server-side. Never take an organization id from a request body or from model output.
- **Agent actions go through `authorizeToolCall`.** New tools are added to `TOOL_DEFINITIONS` with a strict schema, a
  capability, and tests. The model never gets SQL, URLs or code execution.
- **Never tell a caller something is done** unless the source of truth confirmed it (`mayAnnounceConfirmed`).
- **No secrets in code, logs, chat or test fixtures.** `.env*` is git-ignored; use `.env.example` for names only.
- **Pricing and provider rates are data.** Rates live in `packages/core/src/costs/rates.ts` with source, date and a
  `verified` flag. Plans live in the `plans` table.
- **Recording is opt-in, transcripts have retention, AI disclosure is in every greeting.** Don't change these defaults
  without a legal decision recorded in `docs/external-actions.md`.
- Ask before spending money, provisioning paid resources, touching production data, or destructive operations.

## Commands

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @vp/core test        # unit tests
pnpm db:test                       # spins up a throwaway local Postgres, applies shim + migrations, runs DB/server tests
cd apps/web && pnpm build          # needs NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY set (placeholders are fine to build)
```

`supabase/tests/supabase_shim.sql` emulates Supabase roles and `auth.uid()` for local tests only. Never apply it to a
Supabase project.

## Conventions

- TypeScript strict, no `.js` extensions in relative imports (Turbopack resolves sources directly).
- Domain logic stays pure in `packages/core` (inject `now`, no I/O). I/O lives in `packages/server` or apps.
- UI copy: plain language for business owners, sentence case, errors say what happened and what to do.
- Branches: `main` is deployable; work on `feat/*`, `fix/*`; squash-merge with CI green.
- Commit messages end with the co-author trailer configured for this project.
