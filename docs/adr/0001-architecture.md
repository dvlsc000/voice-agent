# ADR-0001: Overall architecture

- Status: Accepted
- Date: 2026-10-25

## Decision

A **modular monolith** plus one **separately deployed realtime voice gateway**, all on EU infrastructure.

```
                 ┌─────────────────────────── EU ───────────────────────────────┐
 Caller ──PSTN──▶ Twilio (ie1) ──Media Stream (WSS)──▶ Voice gateway (container)  │
                 │                                       │  STT · LLM · TTS (EU)  │
                 │                                       ▼                        │
 Owner / staff ──▶ Next.js web app ──────────────▶ @vp/server (booking engine,    │
 Operators ─────▶ (dashboards, server actions,       tool executor, provisioning)│
                 │  webhooks)                            │                        │
                 │                                       ▼                        │
                 │                Supabase Postgres (eu-west-1) + Auth + Storage  │
                 │                jobs table ◀── worker (same container image)     │
                 └───────────────────────────────────────────────────────────────┘
```

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/core` | Pure domain logic: scheduling, booking state machine, verification, templates, tool allowlist + authorization, prompt compiler, escalation detector, cost model, plans. No I/O. | zod, luxon, libphonenumber |
| `packages/server` | Server-side services with DB access: booking engine, tool executor, business facts, provisioning. | core, pg |
| `packages/db` | Database tests (RLS, constraints, jobs). Generated types later. | pg |
| `apps/web` | Next.js 16 app: client dashboard, operator console, auth, server actions, webhooks. | core, server, Supabase |
| `apps/voice-gateway` | *Not started.* Long-lived WebSocket service bridging telephony audio to STT/LLM/TTS and calling `ToolExecutor`. | core, server |
| `supabase/migrations` | The only way the schema changes. | — |

## Key choices and why

- **Realtime audio is not in Next.js or Edge Functions.** Serverless functions are a poor fit for 15-minute
  bidirectional audio streams; the gateway runs as a small always-on container in an EU region.
- **Background jobs in Postgres** (`jobs` table, `FOR UPDATE SKIP LOCKED`, exponential backoff, dead-lettering) instead
  of a separate queue product: one less vendor and subprocessor, transactional enqueue with the booking write, adequate
  for thousands of jobs/minute. Revisit (pgmq or a managed queue) if throughput demands it.
- **Booking integrity is enforced by the database**: an exclusion constraint makes overlapping live bookings for the
  same staff member impossible regardless of application bugs or races.
- **Server code uses a privileged Postgres connection** (fast, transactional) and must scope every query by an
  organization id resolved server-side. Browser-facing reads use the user's Supabase session and RLS.
- **Published agent versions are immutable**; business facts (hours, services, approved prices, FAQs) are rendered fresh
  at call start, so editing opening hours never requires republishing the assistant.
- **No RAG yet.** SMB knowledge is small; approved facts fit in the prompt. Embeddings (pgvector, tenant-scoped) are
  added only when a client's knowledge exceeds the prompt budget.
- **Pricing is data** (`plans` table), seeded inactive with zero prices — a price must be a deliberate decision.

## Consequences

- Building our own audio pipeline is the largest engineering risk (see ADR-0002 and docs/risks.md).
- Postgres-based jobs need a worker process; it ships in the same image as the voice gateway.
