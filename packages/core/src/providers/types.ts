import type { CompiledAgent } from '../agent/compile';
import type { Slot } from '../scheduling/types';

/**
 * Provider boundaries. Application code depends only on these interfaces, so a voice platform,
 * telephony carrier or calendar can be swapped without touching business logic (ADR-0002).
 */

export type NormalizedCallEvent =
  | { type: 'call.started'; providerCallId: string; to: string; from: string | null; at: string }
  | { type: 'call.transcript'; providerCallId: string; role: 'caller' | 'agent'; text: string; final: boolean; at: string }
  | { type: 'call.tool_requested'; providerCallId: string; toolCallId: string; name: string; args: unknown; at: string }
  | { type: 'call.transferred'; providerCallId: string; target: string; outcome: 'answered' | 'failed' | 'no_answer'; at: string }
  | { type: 'call.ended'; providerCallId: string; durationSec: number; endedBy: 'caller' | 'agent' | 'error' | 'timeout'; at: string }
  | { type: 'call.cost'; providerCallId: string; component: string; amount: number; currency: string; quantity: number; unit: string; at: string };

export interface VoiceProvider {
  readonly id: string;
  /** Create or update the provider-side agent from a compiled, versioned config. Must be idempotent on contentHash. */
  upsertAgent(input: { organizationId: string; agentVersionId: string; compiled: CompiledAgent; voiceId: string }): Promise<{ externalAgentId: string }>;
  /** Point an inbound number at an agent. */
  attachNumber(input: { e164: string; externalAgentId: string }): Promise<void>;
  /** Verify authenticity of a webhook before any parsing (forged-webhook defence). */
  verifyWebhook(headers: Record<string, string | undefined>, rawBody: string, url: string): boolean;
  /** Translate provider payloads to normalized events. Unknown events return []. */
  parseWebhook(rawBody: string): NormalizedCallEvent[];
}

export interface ExternalBookingRef {
  externalId: string;
  etag?: string;
}

export class CalendarConflictError extends Error {
  override name = 'CalendarConflictError';
}
export class CalendarUnavailableError extends Error {
  override name = 'CalendarUnavailableError';
}
/** Write may or may not have happened (timeout after send). Caller must reconcile, never blindly retry. */
export class CalendarOutcomeUnknownError extends Error {
  override name = 'CalendarOutcomeUnknownError';
}

/** Common scheduling interface over built-in calendar, Google Calendar, Microsoft 365, Cal.com, … */
export interface CalendarAdapter {
  readonly kind: 'builtin' | 'google' | 'microsoft' | 'calcom';
  /** Busy intervals for given staff between [from, to). */
  listBusy(input: { staffCalendarIds: Record<string, string>; from: string; to: string }): Promise<Array<{ staffId: string; start: string; end: string }>>;
  /** Must be idempotent on `idempotencyKey` (e.g. stored as an extended property / iCalUID). */
  createBooking(input: { slot: Slot; calendarId: string; title: string; description: string; idempotencyKey: string }): Promise<ExternalBookingRef>;
  findByIdempotencyKey(input: { calendarId: string; idempotencyKey: string; around: string }): Promise<ExternalBookingRef | null>;
  moveBooking(input: { ref: ExternalBookingRef; calendarId: string; slot: Slot }): Promise<ExternalBookingRef>;
  cancelBooking(input: { ref: ExternalBookingRef; calendarId: string }): Promise<void>;
}
