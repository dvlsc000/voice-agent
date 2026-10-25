# Extending the platform

## Add an industry template
Templates are data validated by `templateSchema` (`packages/core/src/templates/schema.ts`).
1. Add a template object in `packages/core/src/templates/builtin.ts` (copy `GENERIC_SERVICE`) and register it in `BUILTIN_TEMPLATES`.
2. Decide: allowed/default capabilities, staff model, terminology (EN + HR), default services, guidance, restrictions,
   booking/lead fields (mark anything special-category or privileged `sensitive: true`), escalation rules with keywords
   in both languages (use `stem*` for Croatian inflections), privacy defaults (recording must stay `false`), and at least
   three evaluation scenarios including one that must NOT happen.
3. Add the id to `createClientSchema.industry` in `packages/server/src/provisioning.ts` and to the Create client form.
4. `pnpm --filter @vp/core test` — the template is validated on import. Changing an existing template: bump `version`;
   existing clients keep their version until a new agent version is published.

## Add a tool (something the assistant can do)
1. Define it in `TOOL_DEFINITIONS` (`packages/core/src/tools/registry.ts`): strict zod schema, capability, whether it's
   consequential (needs `caller_confirmed: true`) or needs verification.
2. Implement it in `ToolExecutor.execute` (`packages/server/src/tool-executor.ts`) — server-side checks only; tenant from the session, never from arguments. Add a dry-run simulation result if it writes anything.
3. Tests: authorization denial cases in `packages/core/test/domain.test.ts`, behaviour against the database in `packages/server/test`.

## Add a voice / speech provider
- Speech recognition: implement `SpeechToText` (`apps/voice-gateway/src/stt/types.ts`).
- Voice: implement `TextToSpeech` returning 8 kHz mono mu-law (`apps/voice-gateway/src/tts/types.ts`); register per language in `LanguageRoutedTts`.
- AI model: any OpenAI-compatible endpoint works through `OpenAICompatibleChatModel` by configuration; otherwise implement `ChatModel`.
- Add the provider's rates to `packages/core/src/costs/rates.ts` with source, date and `verified`.
- Verify EU processing and sign a DPA before using it with client data; add it to the subprocessor list.

## Add a calendar provider (e.g. Microsoft 365)
Implement `CalendarAdapter` (`packages/core/src/providers/types.ts`) with the same guarantees as the Google adapter:
idempotent create (deterministic id or stored key), `CalendarOutcomeUnknownError` on timeouts after sending, busy-time
reads without event contents. Copy the contract tests in `packages/server/test/google-calendar.test.ts`.
Add the provider to `calendarResolver` and an OAuth route pair like `/api/integrations/google/*`.

## Add a language
Add it to `SUPPORTED_LANGUAGES`, the `Localized` type (templates need text in it), prompt rules and greeting in
`agent/compile.ts`, number words in `booking/verification.ts`, clock expressions in `scheduling/time-expressions.ts`,
a voice in the gateway, and evaluation scenarios. Measure recognition accuracy before selling it.
