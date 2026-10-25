# Project status

Updated 2026-10-25. Statuses: Not started · Implemented but untested · Locally tested · Integration tested ·
Staging verified · Production verified · Blocked by external dependency.

**Overall: foundation built and locally tested. Not deployed. Not production-ready.** No real call has been made.

## Components

| Area | Status | Evidence |
|---|---|---|
| Domain logic (`packages/core`): availability incl. DST, colloquial times (IE "half five" vs HR "pola pet"), booking state machine, caller verification, templates (barbershop, dental, law office, generic), tool allowlist + authorization, prompt compiler with AI disclosure, escalation detector, cost model, plans/overage/grace policy | **Locally tested** | 46 unit tests pass |
| Database schema: 4 migrations, ~40 tables, RLS on all, exclusion constraint against double booking, DB-level booking state machine, audit triggers, jobs queue, retention | **Locally tested** on PostgreSQL 16 + Supabase auth shim | 24 tests pass (`pnpm db:test`) |
| Same schema on Supabase (PG 17) | **Blocked** — decision D1 (existing tables clash) | — |
| Booking engine + tool executor (`packages/server`): availability, hold→commit→confirm, idempotent replay, verify/reschedule/cancel, external-calendar failure handling, messages, transfers, PII-redacted call trace | **Integration tested** against real Postgres (no external calendar, no voice) | 9 tests pass |
| Client provisioning from template (idempotent, draft agent, go-live blockers) | **Integration tested** against real Postgres | 3 tests pass |
| Web app: magic-link sign-in (invite-only), MFA gate for operators, client dashboard (Today rail, calls, call detail, bookings, messages, hours & prices), operator console (overview, clients, create client, client checklist) | **Implemented, builds** — not run against a live Supabase project; **not visually reviewed** (no headless browser available in this workspace) | `next build` succeeds, 17 routes |
| Voice gateway (Twilio Media Streams → STT → LLM → TTS) | **Not started** — blocked on A2–A6 | — |
| Google Calendar / Microsoft 365 adapters | Not started (interface + failure semantics done and tested with fakes) | — |
| Stripe billing, webhooks | Not started (plans, overage, grace policy logic done) | — |
| Notifications (email/SMS worker) | Not started (jobs are enqueued with dedupe keys) | — |
| Website import for onboarding | Not started | — |
| CI | Workflow written, **not run** (no GitHub connection) | `.github/workflows/ci.yml` |

## Test results (latest run)

| Suite | Result |
|---|---|
| `packages/core` unit | 46/46 passed |
| `packages/db` RLS & integrity (local PG16) | 24/24 passed |
| `packages/server` booking flow + provisioning (local PG16) | 12/12 passed |
| `apps/web` typecheck + production build | passed |

## Deployed

Nothing.

## Next implementation steps

1. Apply migrations to a Supabase dev project (after D1) and re-run the RLS suite there; run advisors.
2. Voice gateway spike: Pipecat vs LiveKit Agents on Twilio `ie1` with Deepgram EU — measure latency gate.
3. Croatian STT/TTS bake-off.
4. Notification worker (email first), stale-`committing` sweeper, usage roll-up job.
5. Google Calendar adapter with contract tests.
6. Stripe subscriptions + webhook handler.
