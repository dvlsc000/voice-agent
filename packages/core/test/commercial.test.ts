import { describe, expect, it } from 'vitest';
import {
  RATES,
  costPerMinute,
  minimumViablePriceEur,
  planEconomics,
  previewInvoice,
  serviceLevelForBilling,
  usageAlertLevel,
  type Plan,
} from '../src/index';

const starter: Plan = {
  code: 'starter',
  name: 'Starter',
  priceMinor: 9900,
  currency: 'EUR',
  includedMinutes: 300,
  overagePerMinuteMinor: 30,
  includedPhoneNumbers: 1,
  includedLocations: 1,
  includedAgents: 1,
  allowedCapabilities: ['reception', 'booking', 'messages'],
  hardMinuteCap: null,
  supportTier: 'standard',
};

describe('cost model', () => {
  it('every rate has a source and date', () => {
    for (const [k, r] of Object.entries(RATES)) {
      expect(r.source.length, k).toBeGreaterThan(5);
      expect(r.asOf, k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('reports unverified inputs instead of hiding them', () => {
    const c = costPerMinute({ country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'small' });
    expect(c.total).toBeGreaterThan(0);
    expect(c.unverifiedInputs.length).toBeGreaterThan(0);
  });
  it('eu_native is cheaper per minute than a platform with a per-minute fee', () => {
    const own = costPerMinute({ country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'small' }).total;
    const vapi = costPerMinute({ country: 'IE', language: 'en', stack: 'vapi_eu', llmTier: 'small' }).total;
    expect(own).toBeLessThan(vapi);
  });
  it('minimum viable price yields the target margin at full allowance', () => {
    const profile = { country: 'IE', language: 'en', stack: 'eu_native', llmTier: 'small' } as const;
    const price = minimumViablePriceEur(300, profile, 20, 0.7);
    const econ = planEconomics({ priceEurMonthly: price, includedMinutes: 300, profile, clientCount: 20 });
    expect(econ.grossMarginPct).toBeGreaterThanOrEqual(0.7);
  });
});

describe('billing', () => {
  it('bills overage on aggregated, rounded-up minutes', () => {
    expect(previewInvoice(starter, { billableSeconds: 300 * 60 })).toHaveLength(1);
    const lines = previewInvoice(starter, { billableSeconds: 300 * 60 + 61 });
    expect(lines[1]).toMatchObject({ quantity: 2, amountMinor: 60 });
  });
  it('raises usage alerts', () => {
    expect(usageAlertLevel(starter, { billableSeconds: 240 * 60 })).toBe('eighty_percent');
    expect(usageAlertLevel(starter, { billableSeconds: 300 * 60 })).toBe('included_exhausted');
  });
  it('never cuts the phone line on the first failed payment', () => {
    expect(serviceLevelForBilling('past_due', 1)).toBe('full');
    expect(serviceLevelForBilling('past_due', 20)).toBe('messages_only');
    expect(serviceLevelForBilling('unpaid', 45)).toBe('forward_only');
  });
});
