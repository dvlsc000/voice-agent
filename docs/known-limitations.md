# Known limitations

Updated 2026-10-25. These are true of the code today; each has an owner action or a backlog item.

## Not yet verified with real providers
- **No real phone call has been made.** The gateway is tested end to end with simulated speech and a scripted model;
  real Twilio, Deepgram, Azure and model behaviour (latency, audio quality, Croatian accuracy) is unmeasured.
- The Twilio request-signature algorithm and the `api.dublin.ie1.twilio.com` host are implemented from documentation;
  confirm with the first live webhook and call update.
- Deepgram model choice for Croatian (`nova-3` with `language=hr`) is an assumption — verify it is supported, or use the
  Soniox adapter (not yet written).
- Stripe, Google Calendar and Resend integrations are contract-tested against simulated APIs, not live accounts.
- The web dashboards have never been opened in a browser (no headless browser available while building). Expect some
  visual polish work after the first look.

## Product gaps
- **Language switching mid-call**: speech recognition runs in the business's primary language. A bilingual business
  answers in one language per number. (Option: a second number per language, or multilingual STT once Croatian is supported.)
- **Microsoft 365 / Outlook calendars**: interface ready, adapter not written. Only Google Calendar and the built-in diary work.
- **Croatian voice** requires an Azure Speech key; without it Croatian calls are transferred to the business.
- **Soniox** (best-value Croatian STT/TTS per research) has no adapter yet.
- **Warm transfer** (assistant briefs the staff member before connecting) is not implemented; transfers are cold with voicemail fallback.
- **Outbound calls / reminders by phone**: not built (SMS/email reminders are).
- **Booking through dashboards**: owners see bookings but can't create/move them in the dashboard yet (they can in their Google Calendar when connected).
- **Recording**: off and cannot be enabled until a legal decision; the storage/retention plumbing exists, playback UI doesn't.
- **Multi-location** businesses: schema supports locations; availability uses the primary location only.
- **RAG/document upload**: answers are short approved FAQs; no document upload or vector search (by design for now).
- **Website import** reads one or two pages; booking-site price lists (Fresha, Treatwell) aren't read.
- **SSRF guard** resolves DNS before fetching but does not pin the connection to the checked address (DNS-rebinding
  residual risk; impact limited to reading a page).
- **Rate limiting** of inbound calls per caller (toll fraud/spam) is not implemented beyond per-call limits and maximum call length.
- **Usage limits**: hard minute caps are modelled in plans but not enforced at call start.

## Operational gaps
- Error monitoring (e.g. Sentry) and log shipping are not wired; the gateway logs JSON to stdout.
- No load test has been run for concurrent calls.
- Backups and restore are not configured/drilled for production (see `operations/backup-restore.md`).
- Pricing plans exist but are inactive with zero prices — set them in the operator console when decided.
