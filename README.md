# Voice reception platform

Multi-tenant AI phone reception for small businesses in Ireland and Croatia: answers calls, books appointments,
takes messages and enquiries, and gives each business a simple dashboard. Built as one shared platform where adding a
client is configuration, not code.

**Status: all phases implemented and tested against simulated providers; database live on the Supabase dev project; not deployed.** See [docs/STATUS.md](docs/STATUS.md).

| Doc | What's in it |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules for anyone (human or AI) changing this repo |
| [docs/adr/0001-architecture.md](docs/adr/0001-architecture.md) | System architecture |
| [docs/adr/0002-voice-stack.md](docs/adr/0002-voice-stack.md) | Voice/telephony provider comparison and decision |
| [docs/adr/0003-tenancy-security.md](docs/adr/0003-tenancy-security.md) | Tenant isolation, roles, agent safety |
| [docs/cost-model.md](docs/cost-model.md) | Unit economics with sourced rates |
| [docs/risks.md](docs/risks.md) | Risk register |
| [docs/external-actions.md](docs/external-actions.md) | Decisions, accounts and legal reviews needed from the business |
| [docs/playground.md](docs/playground.md) | **Try the assistant without a phone number** (typed chat or microphone) |
| [docs/launch-checklist.md](docs/launch-checklist.md) | Everything required before calling it production-ready |
| [docs/known-limitations.md](docs/known-limitations.md) | What doesn't work yet, honestly |
| [docs/operations/](docs/operations/) | Deployment, incident response, backups, onboarding SOP, extending, troubleshooting |

## Local development

Requires Node 22, pnpm 10 and a local PostgreSQL 16+ (for database tests).

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @vp/core test
pnpm db:test
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase URL/keys
pnpm --filter @vp/web dev
```
