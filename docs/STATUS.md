# Project status

Updated 2026-10-25. Statuses: Not started · Implemented but untested · Locally tested · Integration tested ·
Staging verified · Production verified · Blocked by external dependency.

**Overall: all phases implemented and tested against simulated providers; database live on the Supabase development
project; web app and voice gateway not deployed. Pilot-ready once provider accounts exist and the launch checklist's
verification section passes. Not production-ready.** No real phone call has been made yet.

## Components

| Area | Status | Evidence |
|---|---|---|
| Domain logic: scheduling (DST), IE/HR colloquial times, booking state machine, caller verification, templates, tool authorization, prompt compiler, escalation detector, cost model, plans/grace policy, notification templates | **Locally tested** | 46 unit tests |
| Database: 7 migrations, RLS on every table, double-booking exclusion constraint, DB-level state machine, audit, jobs, retention, test runs, billing order-safety | **Integration tested** on Supabase dev (PG 17.11, eu-west-1): live isolation check 16/16; security advisor only intentional INFO notes; FK indexes added. Also 24 local RLS tests | advisors, `list_migrations` |
| Booking engine + tool executor | **Integration tested** (real Postgres) | 9 tests |
| Client provisioning from templates | **Integration tested** | 3 tests |
| Background worker: confirmations, staff alerts, reminders, daily summaries, booking sweeper/reconciliation, retention, usage roll-up, Stripe usage reporting | **Integration tested** (console email sender) | 6 tests |
| Conversation engine: streaming model client, sentence streaming, escalation safety net, outcomes, model-outage handling | **Integration tested** with scripted model | 7 tests |
| Voice gateway: Twilio webhooks (signature-checked), media-stream WebSocket, Deepgram EU STT, Deepgram Aura / Azure TTS, barge-in, silence, max length, fallbacks, transfers, voicemail, call finalisation | **Integration tested end to end with simulated speech + model** (real HTTP/WebSocket/DB) — **Blocked** for live: Twilio/Deepgram/Azure/model accounts | 13 tests incl. full simulated booking call |
| Call routing, billing-aware service levels, cost and usage per call | **Integration tested** | 4 tests |
| Agent versions: drafts, dry-run test calls (real model in production), publish gate, rollback | **Integration tested** with rule-based model | 5 tests |
| Google Calendar: OAuth (signed state), Vault token storage (verified on Supabase), idempotent adapter, busy times, reconciliation | **Integration tested** against simulated Google API — **Blocked** for live: Google OAuth app | 8 + 2 tests |
| Stripe: checkout, portal, verified/idempotent/order-safe webhooks, meter-event usage, dunning | **Integration tested** against simulated Stripe — **Blocked** for live: Stripe account | 7 tests |
| Onboarding: SSRF-safe website import (robots.txt, evidence), reviewed apply, number connection, supervised call, go-live gate | **Integration tested** | 8 + 5 tests |
| Privacy: access export, verified erasure with audit scrubbing | **Integration tested** | 3 tests |
| Web app: client dashboard (today rail, calls, call detail, bookings, messages, settings: hours/services/calendar/staff/closures/answers/team, billing), operator console (overview, clients, create client, set up & go live, assistant versions & tests, plans, operations, privacy) | **Implemented, builds** — not run against live Supabase; **not visually reviewed** | `next build` succeeds (29 routes) |
| Documentation: ADRs, cost model, risks, deployment, incident response, backups, onboarding SOP, extending, troubleshooting, limitations, launch checklist | Written | `docs/` |
| CI | Written; **runs on GitHub** (push to `dvlsc000/voice-agent`) — check the Actions tab | `.github/workflows/ci.yml` |

## Test results (latest full run)

| Suite | Result |
|---|---|
| `packages/core` unit | 46/46 passed |
| `packages/db` RLS & integrity (local PG16) | 24/24 passed |
| `packages/server` integration (local PG16) | 67/67 passed |
| `apps/voice-gateway` session + end-to-end simulated call | 13/13 passed |
| Live Supabase isolation check (PG17) | 16/16 expected results |
| `apps/web` typecheck + production build | passed |

## Deployed

- Database schema (7 migrations) to the Supabase **development** project. No client data.
- Code pushed to GitHub `dvlsc000/voice-agent`.
- Web app and voice gateway: **not deployed** (no hosting accounts yet).

## What blocks a pilot

See `docs/external-actions.md` (accounts A2–A11) and `docs/launch-checklist.md`. Shortest path to a first real call:
Twilio (ie1) + Deepgram + an EU model key + a host for the gateway → deploy → one supervised call.
