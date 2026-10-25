# Incident response

Open an incident in the operator console (Operations → Open an incident) for anything affecting callers. Severity:

| Severity | Meaning | Response |
|---|---|---|
| SEV1 | Calls not answered or callers hearing errors for one or more clients | Start immediately, any hour |
| SEV2 | Degraded: slow responses, bookings failing, notifications not sent | Same business day |
| SEV3 | Minor or single-client cosmetic issue | Next working day |

## Safety nets already in place

- If the gateway can't set up a call, Twilio falls through to **dialling the business's fallback number**.
- If speech recognition, the AI model or the voice fails mid-call, the caller is **transferred to the fallback number**, or told to call back if none is set.
- Bookings are never announced as confirmed unless the calendar confirmed them; uncertain ones go to "Check calendar" and the owner is emailed.

## Playbooks

**Calls not answered / callers hear the "can't take your call" message**
1. Operations page → Voice gateway status. If red: check the hosting dashboard, restart, scale up.
2. Check the gateway logs for `twilio.signature_invalid` — usually `PUBLIC_BASE_URL` doesn't match the URL Twilio calls.
3. Check `http.error` / `stream.setup_failed` events. Database unreachable → Supabase status page.
4. If it can't be fixed within minutes: in Twilio, point affected numbers' Voice URL directly at a TwiML Bin that `<Dial>`s the business's fallback number.

**AI model outage (`llm.error` events, callers transferred)**
1. Check the provider's status page. 2. If prolonged, switch `LLM_BASE_URL`/`LLM_MODEL` to the backup EU provider and
restart the gateway. 3. Run test calls for a few clients before closing the incident.

**Speech recognition or voice outage (`stt.error`, `tts.error`)** — same as above with the Deepgram/Azure settings.

**Bookings failing for one client**
1. Operations → "Calendar connections needing attention". Revoked Google access → ask the owner to reconnect in Settings.
2. Check failed `reconcile_booking` jobs; retry after fixing.
3. Look for appointments in `needs_reconciliation`; the owner was emailed for each.

**Payment webhook failures** — Operations → Failed webhooks. Fix the cause, then "Resend" from the Stripe dashboard (processing is idempotent).

**Suspected data breach** — treat as SEV1. Preserve logs. Within 72 hours the controller (the client business) must be told so they can notify the Data Protection Commission (IE) / AZOP (HR) where required; this is a legal process — involve your adviser immediately (see `docs/external-actions.md` L1).

## After every SEV1/SEV2
Write a short note: what happened, impact (which clients, how many calls), timeline, root cause, what changes. Resolve the incident in the console.
