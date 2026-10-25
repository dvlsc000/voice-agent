import type { z } from 'zod';
import type { Capability } from '../templates/schema';
import { TOOL_DEFINITIONS, toolRequiresCapability, type ToolName } from './registry';

/** Server-side context for a live call. Built from the database, never from model output. */
export interface CallContext {
  organizationId: string;
  callId: string;
  agentVersionId: string;
  enabledCapabilities: readonly Capability[];
  /** Tools published in this agent version (subset of TOOL_DEFINITIONS). */
  agentToolAllowlist: readonly ToolName[];
  /** Booking IDs the caller has proven ownership of during this call. */
  verifiedBookingIds: ReadonlySet<string>;
  /** Slot keys (`staffId|startISO`) offered to the caller by check_availability in this call. */
  offeredSlots: ReadonlySet<string>;
  toolCallsSoFar: number;
  consequentialCallsSoFar: number;
  organizationStatus: 'active' | 'trial' | 'suspended' | 'onboarding';
}

export const LIMITS = {
  maxToolCallsPerCall: 40,
  maxConsequentialPerCall: 6,
} as const;

export type AuthorizationDenial =
  | 'unknown_tool'
  | 'not_in_agent_allowlist'
  | 'capability_disabled'
  | 'invalid_arguments'
  | 'not_verified'
  | 'slot_not_offered'
  | 'rate_limited'
  | 'organization_inactive';

export type AuthorizationResult<T = unknown> =
  | { allowed: true; tool: ToolName; args: T }
  | { allowed: false; reason: AuthorizationDenial; detail?: string };

export function slotKey(staffId: string, startISO: string): string {
  return `${staffId}|${new Date(startISO).toISOString()}`;
}

/**
 * Deterministic gate in front of every tool execution. The LLM requesting an action grants nothing.
 * Execution code must call this and act only on `allowed: true`, using the parsed `args`.
 */
export function authorizeToolCall(ctx: CallContext, name: string, rawArgs: unknown): AuthorizationResult {
  if (!Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, name)) return { allowed: false, reason: 'unknown_tool' };
  const tool = name as ToolName;
  const def = TOOL_DEFINITIONS[tool];

  if (ctx.organizationStatus === 'suspended' && tool !== 'take_message' && tool !== 'end_call' && tool !== 'transfer_to_human') {
    return { allowed: false, reason: 'organization_inactive' };
  }
  if (!ctx.agentToolAllowlist.includes(tool)) return { allowed: false, reason: 'not_in_agent_allowlist' };
  if (!toolRequiresCapability(tool, ctx.enabledCapabilities)) return { allowed: false, reason: 'capability_disabled' };
  if (ctx.toolCallsSoFar >= LIMITS.maxToolCallsPerCall) return { allowed: false, reason: 'rate_limited' };
  if (def.consequential && ctx.consequentialCallsSoFar >= LIMITS.maxConsequentialPerCall) {
    return { allowed: false, reason: 'rate_limited' };
  }

  const parsed = (def.args as z.ZodTypeAny).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { allowed: false, reason: 'invalid_arguments', detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const args = parsed.data as Record<string, unknown>;

  if (def.requiresVerification) {
    const bookingId = args.booking_id as string;
    if (!ctx.verifiedBookingIds.has(bookingId)) return { allowed: false, reason: 'not_verified' };
  }

  // Booking/rescheduling may only target a slot this call was actually offered — stops the model from
  // inventing times or a prompt-injected caller from dictating arbitrary timestamps.
  if (tool === 'book_appointment' && !ctx.offeredSlots.has(slotKey(args.staff_id as string, args.start as string))) {
    return { allowed: false, reason: 'slot_not_offered' };
  }
  if (tool === 'reschedule_booking' && !ctx.offeredSlots.has(slotKey(args.staff_id as string, args.new_start as string))) {
    return { allowed: false, reason: 'slot_not_offered' };
  }

  return { allowed: true, tool, args };
}

/** Message the agent receives on denial — tells it what to do next without leaking internals. */
export function denialGuidance(reason: AuthorizationDenial): string {
  switch (reason) {
    case 'not_verified':
      return 'The caller has not been verified for this booking. Ask for their booking reference and phone number and call verify_caller_booking.';
    case 'slot_not_offered':
      return 'That time was not offered. Call check_availability and offer one of the returned times.';
    case 'invalid_arguments':
      return 'Some details are missing or invalid. Ask the caller for the missing information.';
    case 'capability_disabled':
    case 'not_in_agent_allowlist':
    case 'unknown_tool':
      return 'You cannot do this on this line. Offer to take a message instead.';
    case 'rate_limited':
      return 'Too many actions on this call. Offer to take a message for the team.';
    case 'organization_inactive':
      return 'Bookings are unavailable right now. Offer to take a message.';
  }
}
