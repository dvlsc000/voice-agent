# Risk register

Updated 2026-10-25. Likelihood/impact: L/M/H.

| # | Risk | L | I | Mitigation | Status |
|---|---|---|---|---|---|
| R1 | Own voice pipeline misses latency/naturalness targets | M | H | Use Pipecat/LiveKit Agents instead of hand-rolling VAD/barge-in; latency gate in ADR-0002; Vapi EU as fallback behind the same interfaces | Open — spike not started |
| R2 | Croatian speech recognition errors on names, numbers, "pola pet" | M | H | Blind STT bake-off on recorded Croatian test set; read-back confirmation of numbers; deterministic time interpreter; per-language error metrics | Open |
| R3 | A subprocessor processes EU data outside the EEA | M | H | EU endpoints only (Twilio ie1, Deepgram EU, Soniox EU, EU LLM); DPAs; Retell excluded | Open — DPAs not signed |
| R4 | Double booking / false "confirmed" | L | H | DB exclusion constraint; state machine in app **and** DB; "confirmed" only after source of truth acknowledges; reconciliation state for timeouts | Mitigated, tested locally |
| R5 | Cross-tenant data leak | L | H | RLS on every table, composite FKs, column grants, server queries scoped by resolved org id; automated tests | Mitigated, tested locally (not yet on Supabase PG17) |
| R6 | Prompt injection makes the agent act wrongly | M | M | Deterministic tool authorization, offered-slot rule, strict schemas, verification before changes, facts-as-data | Mitigated in code; needs adversarial voice evals |
| R7 | Agent gives medical/legal advice | M | H | Template restrictions, deterministic escalation detector, eval scenarios; human review gate before going live | Partly — evals need live model |
| R8 | Croatian telephony costs/regulation make HR uneconomic | M | M | BYOC via Croatian carrier; keep client's own number with forwarding | Open — quote needed |
| R9 | Toll fraud / inference abuse via spam calls | M | M | Max call duration, per-call tool limits, per-tenant usage alerts; spam outcome; add caller rate limiting in gateway | Partly |
| R10 | Admin account compromise | L | H | MFA (AAL2) enforced for operator console; invite-only sign-in; audit log with actor | Implemented, untested against live Supabase Auth |
| R11 | Stuck `committing` bookings if a process dies mid-write | L | M | Sweep job to move stale `committing` rows to `needs_reconciliation` | **Backlog** |
| R12 | Unit economics rely on unverified prices | M | M | Every rate tagged verified/unverified; replace with quotes before pricing | Open |
| R13 | Single developer workspace; code not yet in your GitHub | H | M | Connect GitHub (A1) | Open |
