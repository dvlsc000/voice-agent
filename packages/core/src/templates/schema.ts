import { z } from 'zod';

export const CAPABILITIES = [
  'reception', // FAQs, hours, location, approved prices
  'booking',
  'rescheduling',
  'cancellation',
  'lead_intake',
  'messages', // take a message / callback request
  'human_handoff',
  'sms_confirmations',
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const capabilitySchema = z.enum(CAPABILITIES);

const localized = z.object({ en: z.string().min(1), hr: z.string().min(1) });
export type Localized = z.infer<typeof localized>;

export const escalationRuleSchema = z.object({
  id: z.string(),
  /** Plain-language description of the trigger given to the model; deterministic keyword hints back it up. */
  trigger: localized,
  keywords: z.object({ en: z.array(z.string()), hr: z.array(z.string()) }).default({ en: [], hr: [] }),
  action: z.enum(['transfer_now', 'emergency_instructions', 'urgent_callback', 'take_message']),
  /** Spoken guidance — e.g. "If this is a medical emergency, hang up and call 112." */
  script: localized,
});

export const intakeFieldSchema = z.object({
  key: z.string().regex(/^[a-z_]+$/),
  label: localized,
  required: z.boolean(),
  /** Marks fields that may contain special-category or privileged data; they are excluded from summaries sent by email. */
  sensitive: z.boolean().default(false),
});

export const templateSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  version: z.number().int().positive(),
  name: localized,
  allowedCapabilities: z.array(capabilitySchema).min(1),
  defaultCapabilities: z.array(capabilitySchema).min(1),
  staffModel: z.enum(['named_staff_choice', 'any_available', 'none']),
  terminology: z.object({ staff: localized, customer: localized, appointment: localized }),
  defaultServices: z.array(
    z.object({
      name: localized,
      durationMin: z.number().int().positive(),
      bufferAfterMin: z.number().int().min(0).default(0),
      priceMinor: z.number().int().min(0).nullable(),
      priceIsFrom: z.boolean().default(false),
    }),
  ),
  guidance: localized,
  /** Absolute prohibitions, injected verbatim and enforced by tool policy where possible. */
  restrictions: z.array(localized),
  bookingFields: z.array(intakeFieldSchema),
  leadFields: z.array(intakeFieldSchema).default([]),
  escalation: z.array(escalationRuleSchema),
  privacy: z.object({
    sensitivity: z.enum(['standard', 'elevated', 'special_category']),
    verificationMethod: z.enum(['reference_and_phone', 'sms_otp']),
    transcriptsDefault: z.boolean(),
    recordingDefault: z.literal(false), // recording is always opt-in (spec §18)
    transcriptRetentionDays: z.number().int().positive(),
  }),
  evaluationScenarios: z.array(
    z.object({
      id: z.string(),
      language: z.enum(['en', 'hr']),
      callerScript: z.string(),
      expect: z.object({
        tools: z.array(z.string()).default([]),
        forbiddenTools: z.array(z.string()).default([]),
        outcome: z.enum(['booked', 'message_taken', 'transferred', 'info_given', 'lead_captured', 'escalated', 'declined']),
        mustNotSay: z.array(z.string()).default([]),
      }),
    }),
  ),
}).superRefine((t, ctx) => {
  for (const c of t.defaultCapabilities) {
    if (!t.allowedCapabilities.includes(c)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `default capability ${c} is not allowed` });
    }
  }
});

export type IndustryTemplate = z.infer<typeof templateSchema>;
