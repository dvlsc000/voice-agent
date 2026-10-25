import { z } from 'zod';
import { capabilitySchema } from '../templates/schema.js';

/** Plans are data (DB rows), not code — prices change without deployments (spec §16, §29). */
export const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  priceMinor: z.number().int().min(0), // per month, EUR cents
  currency: z.literal('EUR'),
  includedMinutes: z.number().int().min(0),
  overagePerMinuteMinor: z.number().int().min(0), // EUR cents per started minute beyond allowance
  includedPhoneNumbers: z.number().int().min(0),
  includedLocations: z.number().int().min(1),
  includedAgents: z.number().int().min(1),
  allowedCapabilities: z.array(capabilitySchema),
  hardMinuteCap: z.number().int().positive().nullable(), // null = overage billed, never cut off
  supportTier: z.enum(['standard', 'priority', 'dedicated']),
});
export type Plan = z.infer<typeof planSchema>;

export interface UsageSummary {
  billableSeconds: number;
}

export interface InvoicePreviewLine {
  description: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
}

/** Minutes are aggregated per period in seconds and rounded up once, not per call — fairer and easier to explain. */
export function billableMinutes(usage: UsageSummary): number {
  return Math.ceil(Math.max(0, usage.billableSeconds) / 60);
}

export function previewInvoice(plan: Plan, usage: UsageSummary): InvoicePreviewLine[] {
  const lines: InvoicePreviewLine[] = [
    { description: `${plan.name} subscription`, quantity: 1, unitAmountMinor: plan.priceMinor, amountMinor: plan.priceMinor },
  ];
  const over = Math.max(0, billableMinutes(usage) - plan.includedMinutes);
  if (over > 0 && plan.overagePerMinuteMinor > 0) {
    lines.push({
      description: `Additional call minutes beyond ${plan.includedMinutes}`,
      quantity: over,
      unitAmountMinor: plan.overagePerMinuteMinor,
      amountMinor: over * plan.overagePerMinuteMinor,
    });
  }
  return lines;
}

export type UsageAlertLevel = 'none' | 'eighty_percent' | 'included_exhausted' | 'hard_cap_reached';

export function usageAlertLevel(plan: Plan, usage: UsageSummary): UsageAlertLevel {
  const mins = billableMinutes(usage);
  if (plan.hardMinuteCap !== null && mins >= plan.hardMinuteCap) return 'hard_cap_reached';
  if (plan.includedMinutes > 0 && mins >= plan.includedMinutes) return 'included_exhausted';
  if (plan.includedMinutes > 0 && mins >= plan.includedMinutes * 0.8) return 'eighty_percent';
  return 'none';
}

/**
 * What the phone line does for a tenant given billing state. Telephone reception is business-critical,
 * so failure degrades gradually with notice (spec §16): it is never switched off on the first failed payment.
 *
 *  full          — everything enabled
 *  messages_only — agent answers, takes messages / transfers, no new bookings
 *  forward_only  — calls are forwarded straight to the business's own fallback number (no AI cost)
 */
export type ServiceLevel = 'full' | 'messages_only' | 'forward_only';

export const BILLING_GRACE = { fullServiceDays: 14, messagesOnlyUntilDay: 30 } as const;

export function serviceLevelForBilling(
  status: 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete',
  daysPastDue: number,
): ServiceLevel {
  if (status === 'trialing' || status === 'active') return 'full';
  if (status === 'canceled') return 'forward_only';
  if (daysPastDue <= BILLING_GRACE.fullServiceDays) return 'full';
  if (daysPastDue <= BILLING_GRACE.messagesOnlyUntilDay) return 'messages_only';
  return 'forward_only';
}
