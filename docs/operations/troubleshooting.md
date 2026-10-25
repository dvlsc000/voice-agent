# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Twilio webhooks get 403 | `PUBLIC_BASE_URL` differs from the URL Twilio calls (http vs https, trailing slash, proxy) | Make them identical; Twilio signs the exact URL |
| Calls go straight to the business's phone | Client not live, no published assistant, or billing 30+ days overdue | Client page → checklist; Billing status |
| Assistant says "trouble on my side" then transfers | AI model errors | Gateway logs `llm.error`; provider status; key/quota |
| Long pauses before replies | Model or voice latency | `turn.latency` events; `call.latency_summary` per call; try a smaller model or closer region |
| Assistant talks over callers / gets cut off | Endpointing too short/long | `endpointing` (Deepgram) default 300 ms; raise for slow speakers |
| Croatian calls transferred immediately | No Croatian voice configured | Set `AZURE_SPEECH_KEY` (+ voice) on the gateway |
| A time is offered that's busy in the client's Google Calendar | Staff not mapped to that calendar | Settings → Calendar → map the person to the right calendar ID |
| "Check calendar" bookings | Calendar timed out after accepting | Worker reconciles automatically; owner was emailed if it couldn't |
| No confirmation emails | `RESEND_API_KEY` unset (console sender) or customer has no email | Operations → undelivered; set the key |
| Sign-in link never arrives | Supabase default SMTP limits | Configure custom SMTP in Supabase Auth |
| Operator console sends you to two-step verification every time | Expected: AAL2 is required per session | Use your authenticator app |
| Test calls button disabled | Web app has no AI model configured | Set `LLM_BASE_URL`, `LLM_API_KEY` for the web app |
| Stripe subscription not reflected | Webhook secret mismatch or endpoint not subscribed to events | Stripe dashboard → webhook attempts; Operations → failed webhooks |
| DB tests fail locally | Postgres binaries not found or port busy | `PGBIN=/usr/lib/postgresql/16/bin PGPORT=55432 pnpm db:test` |
