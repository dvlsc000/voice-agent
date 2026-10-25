# Production launch checklist

Nothing below is ticked yet unless stated. "Production-ready" means every item is done.

## Accounts and infrastructure
- [ ] Separate **production** Supabase project (EU), paid plan with daily backups (+ PITR recommended); migrations applied; advisors clean
- [x] Development Supabase project with schema, RLS verified on Postgres 17 (2026-10-25)
- [ ] Web app deployed (EU region), custom domain, HTTPS
- [ ] Voice gateway deployed in an EU region, 2 instances, health check alerting
- [ ] Twilio account with `ie1` region; numbers' webhooks pointed at the gateway
- [ ] Deepgram (EU endpoint), Azure Speech (EU region, Croatian voice), EU AI model provider — accounts and keys in the secret store
- [ ] Email provider with verified sending domain; Supabase Auth custom SMTP
- [ ] Stripe live mode: products, monthly prices, call-seconds meter + metered price with included-minute tier; webhook endpoint; customer portal configured
- [ ] Google Cloud OAuth app verified for `calendar.events` + `calendar.freebusy`
- [ ] Error monitoring and log retention

## Verification
- [ ] 20+ real test calls in English (Irish mobiles and landlines) — latency median ≤ 1.2 s, p95 ≤ 2.0 s
- [ ] 20+ real test calls in Croatian with native speakers — recognition of names, dates, "pola pet", phone numbers
- [ ] All template evaluation scenarios pass against the chosen production model
- [ ] Real booking into Google Calendar, reschedule, cancel; calendar outage drill
- [ ] Stripe test-mode end to end: checkout → subscription active → usage reported → invoice; payment failure → grace → recovery
- [ ] Load test: target concurrent calls per gateway instance
- [ ] Backup restore drill completed
- [ ] Security review: dependency audit, penetration test of web app and webhooks, MFA enforced for all operators

## Legal and commercial (adviser)
- [ ] DPA template for clients; subprocessor list published (Supabase, Twilio, Deepgram, Azure, model provider, Stripe, email, Google if used)
- [ ] DPIA for dental and legal clients
- [ ] Privacy notice text for callers (what the greeting says, where to find more)
- [ ] AI Act transparency wording confirmed
- [ ] VAT setup reviewed (Ireland registration, reverse charge for EU B2B, Croatian clients); Stripe Tax decision
- [ ] Terms of service, SLA, grace-period policy wording
- [ ] Croatian (HAKOM) and Irish (ComReg) number-use rules confirmed for your setup
- [ ] Prices set (operator console → Plans), checked against `docs/cost-model.md` with verified rates
