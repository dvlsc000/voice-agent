# ADR-0003: Tenant isolation, authorization and agent safety

- Status: Accepted
- Date: 2026-10-25

## Tenancy

- Shared schema; every tenant row has `organization_id`. **RLS is enabled on every table in `public`.**
- `anon` has no grants anywhere. `authenticated` gets explicit table/column grants; everything else is revoked.
- Policies call `SECURITY DEFINER` helpers in schema `private` (not exposed by the Data API):
  `can_read_org`, `can_configure_org` (owner/manager), `can_operate_org` (+receptionist),
  `can_read_personal_data` (excludes read-only analysts), `is_platform_staff`.
- **Composite foreign keys** `(organization_id, id)` make cross-tenant references impossible even with a valid UUID.
- Column grants stop members changing their own `status`, plan, or reading `reference_salt`.
- Internal tables (`jobs`, `webhook_events`, `usage_events`, `provider_cost_events`, `integration_secrets`) have RLS on,
  **no policies and no grants**: unreachable from any browser session.
- Integration credentials live in **Supabase Vault**; tables store only the vault secret id.

## Roles

| Role | Sees | Can change |
|---|---|---|
| owner | everything in their business | config, members, enquiries |
| manager | everything | config, enquiries |
| receptionist | calls, bookings, customers, transcripts, messages | message status, booking notes |
| analyst | calls, bookings (times/status) — **no customer details, transcripts or messages** | nothing |
| platform_support | all tenants, read-only | nothing (writes go through audited server actions) |
| platform_admin | all tenants | via server actions only, with MFA (AAL2) required |

## Voice agent safety (prompt injection, tool misuse)

The model never holds authority. Every tool call passes `authorizeToolCall` (deterministic):

1. Tool must be in the fixed allowlist, in the published agent version, and enabled by capability.
2. Arguments are validated with **strict** schemas — unknown fields (e.g. a smuggled `organization_id`) are rejected.
3. Tenant comes from the dialled number → call record, never from arguments.
4. Consequential actions require `caller_confirmed: true` and are rate-limited per call.
5. **Bookings may only target a slot that `check_availability` actually offered in this call.**
6. Changing or cancelling a booking requires prior verification (6-digit reference + phone match, max 3 attempts;
   SMS OTP policy for sensitive industries). A name alone never verifies; caller ID alone never verifies.
7. Business facts and knowledge are wrapped as reference data and placed after the rules in the prompt.
8. A deterministic keyword detector runs on every caller utterance for emergencies/escalations, independent of the LLM.
9. Tool traces in `call_events` redact names, phone numbers and free text.

## Tested (local PostgreSQL 16 with a Supabase auth shim)

See `packages/db/test/rls.test.ts` and `packages/server/test/*.test.ts` — cross-tenant reads/writes, anon access,
role limits, column grants, last-owner protection, double booking, racing bookings, state machine, immutability,
job claiming, webhook dedupe, retention. **Still to do on Supabase itself (PG 17):** re-run against a Supabase
branch/project and run `get_advisors`.
