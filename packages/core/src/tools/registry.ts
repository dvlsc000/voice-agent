import { z } from 'zod';
import type { Capability } from '../templates/schema.js';

/**
 * The complete allowlist of actions a voice agent can request. Nothing else is executable.
 * Tenant identity is NEVER an argument: it is resolved server-side from the dialled number / call record.
 */
const isoInstant = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/);

export const TOOL_DEFINITIONS = {
  get_business_info: {
    capability: 'reception',
    consequential: false,
    requiresVerification: false,
    description: 'Return verified business facts: hours, address, services and approved prices, FAQs.',
    args: z.object({ topic: z.enum(['hours', 'location', 'services', 'faq', 'all']).default('all') }).strict(),
  },
  check_availability: {
    capability: 'booking',
    consequential: false,
    requiresVerification: false,
    description: 'Find bookable times for a service. Use date + day_part for vague requests like "tomorrow afternoon".',
    args: z
      .object({
        service_id: uuid,
        staff_id: uuid.optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        day_part: z.enum(['morning', 'afternoon', 'evening', 'any']).default('any'),
      })
      .strict(),
  },
  book_appointment: {
    capability: 'booking',
    consequential: true,
    requiresVerification: false,
    description: 'Book a specific slot previously returned by check_availability, after the caller confirmed it.',
    args: z
      .object({
        service_id: uuid,
        staff_id: uuid,
        start: isoInstant,
        customer_name: z.string().min(1).max(120),
        customer_phone: e164,
        caller_confirmed: z.literal(true),
      })
      .strict(),
  },
  verify_caller_booking: {
    capability: ['rescheduling', 'cancellation'],
    consequential: false,
    requiresVerification: false,
    description: 'Verify the caller owns a booking using their booking reference and phone number.',
    args: z.object({ reference: z.string().min(4).max(40), stated_phone: e164.optional() }).strict(),
  },
  reschedule_booking: {
    capability: 'rescheduling',
    consequential: true,
    requiresVerification: true,
    description: 'Move a verified booking to a new slot returned by check_availability.',
    args: z
      .object({ booking_id: uuid, new_start: isoInstant, staff_id: uuid, caller_confirmed: z.literal(true) })
      .strict(),
  },
  cancel_booking: {
    capability: 'cancellation',
    consequential: true,
    requiresVerification: true,
    description: 'Cancel a verified booking.',
    args: z.object({ booking_id: uuid, caller_confirmed: z.literal(true) }).strict(),
  },
  take_message: {
    capability: 'messages',
    consequential: false,
    requiresVerification: false,
    description: 'Leave a message or callback request for the business.',
    args: z
      .object({
        caller_name: z.string().min(1).max(120),
        callback_phone: e164,
        message: z.string().min(1).max(1000),
        urgent: z.boolean().default(false),
      })
      .strict(),
  },
  request_callback: {
    capability: 'messages',
    consequential: false,
    requiresVerification: false,
    description: 'Register an urgent callback (e.g. clinical or legal urgency) for staff to handle.',
    args: z
      .object({
        caller_name: z.string().min(1).max(120),
        callback_phone: e164,
        reason_category: z.string().min(1).max(80),
        escalation_rule_id: z.string().optional(),
      })
      .strict(),
  },
  capture_lead: {
    capability: 'lead_intake',
    consequential: false,
    requiresVerification: false,
    description: 'Record a new-client enquiry with the template-defined intake fields.',
    args: z
      .object({
        fields: z.record(z.string().max(500)),
        summary: z.string().max(600),
        urgency: z.enum(['normal', 'urgent']).default('normal'),
      })
      .strict(),
  },
  transfer_to_human: {
    capability: 'human_handoff',
    consequential: false,
    requiresVerification: false,
    description: 'Transfer the call to the configured staff number. Falls back to a message if nobody answers.',
    args: z.object({ reason: z.string().max(200) }).strict(),
  },
  end_call: {
    capability: null,
    consequential: false,
    requiresVerification: false,
    description: 'End the call politely once the caller is done.',
    args: z.object({ outcome: z.enum(['completed', 'caller_hung_up', 'spam', 'wrong_number']) }).strict(),
  },
} as const satisfies Record<
  string,
  {
    capability: Capability | readonly Capability[] | null;
    consequential: boolean;
    requiresVerification: boolean;
    description: string;
    args: z.ZodTypeAny;
  }
>;

export type ToolName = keyof typeof TOOL_DEFINITIONS;
export const TOOL_NAMES = Object.keys(TOOL_DEFINITIONS) as ToolName[];

export function toolRequiresCapability(name: ToolName, enabled: readonly Capability[]): boolean {
  const cap: Capability | readonly Capability[] | null = TOOL_DEFINITIONS[name].capability;
  if (cap === null) return true;
  if (typeof cap === 'string') return enabled.includes(cap);
  return cap.some((c) => enabled.includes(c));
}

export function toolsForCapabilities(enabled: readonly Capability[]): ToolName[] {
  return TOOL_NAMES.filter((n) => toolRequiresCapability(n, enabled));
}
