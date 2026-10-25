# ADR-0002: Voice and telephony stack for Ireland and Croatia

- Status: **Accepted (provisional)** — pending live latency/quality tests with real accounts
- Date: 2026-10-25
- Sources verified on 2026-10-25 unless marked otherwise

## Context

The product handles personal data from callers (and, for dental and law clients, potentially special-category or
privileged data). Callers are in Ireland and Croatia; Croatian must sound natural. Margins depend on the per-minute cost.

## What was verified

| Question | Finding | Source |
|---|---|---|
| Retell AI EU data residency | **None.** Retell staff (1 May 2026): no EU operations; STT, TTS, telephony and storage run in AWS US. Only a self-hosted custom LLM can stay in the EU. | community.retellai.com thread "Retell + NIS2" |
| Vapi EU region | Exists (`api.eu.vapi.ai`, `sip.eu.vapi.ai`), but **requires the Premier Success package via sales**. Price not published. | docs.vapi.ai/security-and-privacy/eu-region |
| Vapi platform fee | ~$0.05/min plus pass-through STT/LLM/TTS/telephony | third-party summary (activepieces.com, 16 Oct 2026) — **unverified** |
| ElevenLabs Agents EU residency | Exists but **Enterprise only**; some processing may still occur outside the EU unless Zero Retention Mode | elevenlabs.io/docs/overview/administration/data-residency |
| Twilio Ireland | Local number $1.80/mo, inbound $0.0100/min, SIP/BYOC $0.0040/min, outbound IE mobile $0.0945/min | twilio.com/en-us/voice/pricing/ie |
| Twilio EU media processing | Regional routing to `ie1` (Ireland) is supported, including Media Streams | twilio.com changelog (Apr 2024), ElevenLabs regional routing doc |
| Twilio Croatia | Local and toll-free numbers listed; **local inbound price not published**; toll-free inbound **$0.315/min**; business registration needs court-register excerpt and an address **in the number's local area** | twilio.com/voice/pricing/hr, twilio.com/en-us/guidelines/hr/regulatory |
| Deepgram EU | `api.eu.deepgram.com` GA, STT + TTS + Voice Agent API, processing in the EU, no extra price | deepgram.com/learn/deepgram-eu-endpoint-now-generally-available |
| Deepgram Croatian | Croatian real-time STT advertised; model not named on the page | deepgram.com/product/speech-to-text/croatian |
| Soniox | Croatian real-time STT ($0.12/h) and TTS ($0.70/h generated), EU data residency listed for Croatian | soniox.com/platform/croatian |
| Mistral | Small 4: $0.10/$0.30 per M tokens | third-party summary (developer.puter.com, 20 Oct 2026) — **unverified**; EU processing location **not yet confirmed** |

## Options compared

| | A. EU-native pipeline (ours) | B. Vapi EU region | C. Retell | D. ElevenLabs Agents EU |
|---|---|---|---|---|
| EU processing of audio/transcripts | Yes, by choosing EU endpoints for every leg | Yes for Vapi; per-provider for STT/TTS/LLM | **No** | Partly (stored in EU; some processing may be elsewhere) |
| Est. variable cost/min (IE, EN) | **≈ $0.040** | ≈ $0.093 + Premier package | ≈ $0.099 | Enterprise quote |
| Fixed cost | 1 small EU container (~$40/mo) | Premier Success package (unpublished) | none | Enterprise contract |
| Croatian quality control | Choose best STT/TTS per language | Depends on provider choices | Limited control | Good TTS; STT TBD |
| Engineering effort | **Highest** (turn-taking, barge-in, VAD, streaming) | Low | Low | Low |
| Lock-in | Low | Medium | Medium | Medium |

## Decision

1. **Primary: A — an EU-native pipeline** we run ourselves: Twilio (`ie1` region) Media Streams → streaming STT
   (Deepgram EU for English; Soniox or Deepgram EU for Croatian, chosen by blind test) → LLM through an EU endpoint
   (Mistral, or Azure OpenAI / Bedrock EU regions) → EU TTS → back to Twilio.
   Built on an open-source orchestration framework (Pipecat or LiveKit Agents — chosen in a spike) rather than writing
   barge-in/VAD from scratch.
2. **Everything above the audio pipeline is provider-agnostic** (`VoiceProvider`, `CalendarAdapter` interfaces in
   `packages/core/src/providers/types.ts`). Business logic, tool authorization and booking never depend on the vendor.
3. **Fallback: B (Vapi EU)** if the pipeline spike misses the latency/quality gate. The tool executor is already an
   HTTP-callable server function, which is what Vapi's tool webhooks need.
4. **Retell is excluded** for now: no EU processing is a material GDPR/DPIA risk for dental and legal clients.

## Croatia telephony

Twilio's published Croatian pricing makes toll-free numbers uneconomic and local numbers require a local address in the
number's area. Recommended route, in order of preference:
1. **Client keeps their existing number** and forwards to our platform via a **Croatian SIP carrier (BYOC into
   Twilio at $0.004/min)** — needs a carrier quote (external action).
2. Twilio Croatian local number per client, using the client's own court-register documents and address.
3. Call forwarding to an Irish number (the client's carrier charges international forwarding — not recommended).

## Gates before this becomes "Accepted"

- Median response latency (caller stops speaking → agent audio starts) ≤ 1.2 s, p95 ≤ 2.0 s, on real calls from IE and HR mobiles.
- Croatian STT word error rate measured on ≥ 50 recorded test utterances (names, dates, "pola pet", phone numbers).
- Blind listening test of Croatian TTS voices with native speakers.
- Signed DPAs and confirmed processing locations for every subprocessor in the chain.
