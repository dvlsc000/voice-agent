# Remaining external actions

Things only you (or an adviser) can do. Each says why it is needed and what it unblocks.
Updated 2026-10-25. Environment variable names for each service are in `apps/web/.env.example` and `apps/voice-gateway/.env.example`.

## Decisions needed now

| # | Decision | Why it matters | Default if you don't decide |
|---|---|---|---|
| D1 | Prototype tables in Supabase project `didfoshmymuuzdlwhugd` | **Done 2026-10-25:** dropped on your instruction; new schema applied. | — |
| D2 | Use that project as **development** and create a separate **production** project later? | Separate dev/staging/prod credentials (spec §4). A second free project may be possible; a Pro plan costs money. | Treat it as development only. |
| D3 | Product/brand name and domain | White-label emails, sign-in links, phone greeting. | "Reception" placeholder via `NEXT_PUBLIC_BRAND_NAME`. |

## Accounts and credentials (in priority order)

| # | Action | Unblocks |
|---|---|---|
| A1 | ~~Connect GitHub~~ **Done 2026-10-25**: code in `dvlsc000/voice-agent`. | — |
| A2 | **Twilio account** with the **Ireland (`ie1`) region** enabled; one Irish local number for testing. | First real test call. |
| A3 | **Deepgram** account (EU endpoint) and **Soniox** account. | English and Croatian speech recognition tests. |
| A4 | **LLM provider with confirmed EU processing** — Mistral (confirm region + DPA), or Azure OpenAI / AWS Bedrock in an EU region. | The assistant's reasoning step. |
| A5 | **TTS**: confirm an EU-resident option with good Croatian voices (Soniox, Azure hr-HR, ElevenLabs EU Enterprise). | Natural Croatian voice. |
| A6 | **Hosting for the voice gateway** in an EU region (e.g. Fly.io `fra`/`ams`, Railway EU, Hetzner). | Running calls. |
| A7 | **Web hosting** (e.g. Vercel with EU function region) and a domain. | Dashboards for real users. |
| A8 | **Stripe** account (test mode first) + Stripe Tax decision. | Subscriptions and invoices. |
| A9 | **Email provider** (e.g. Postmark/Resend EU) for sign-in links and confirmations; custom SMTP in Supabase Auth. | Reliable sign-in emails (Supabase's default sender is rate-limited and not for production). |
| A10 | **Croatian SIP carrier quote** (for forwarding clients' existing numbers via BYOC). | Croatian launch economics. |
| A11 | **Error monitoring** (e.g. Sentry EU region). | Alerts. |

Never paste secrets into chat. Put them in the hosting provider's secret store or a local `.env` file (git-ignored).

## Legal, tax and compliance review (adviser required)

| # | Topic | Notes |
|---|---|---|
| L1 | **Controller/processor roles and DPA** with each client; subprocessor list | You are processor for clients' callers; a DPA template is needed before the first client. |
| L2 | **DPIA** for dental and legal clients | Special-category / privileged data risk. The product defaults to minimal collection, no recording, short retention. |
| L3 | **Call recording consent** in Ireland vs Croatia | Recording ships disabled; per-jurisdiction notice text needed before enabling. |
| L4 | **EU AI Act transparency** wording | The greeting already discloses "virtual assistant"; confirm wording satisfies Art. 50 obligations. |
| L5 | **VAT**: B2B reverse charge (VAT ID validation), Irish VAT registration, Croatian clients | Tax adviser to confirm Stripe Tax configuration. |
| L6 | **Croatian number regulation (HAKOM)** and Irish (ComReg) rules for number use and forwarding | Before provisioning numbers for clients. |
| L7 | Terms of service, SLA wording, grace period policy for unpaid accounts | Product implements: full service 14 days past due, messages-only to day 30, then forward-only — never silent disconnection. |
