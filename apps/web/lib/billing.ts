import 'server-only';
import { StripeClient, type BillingConfig } from '@vp/server';
import { billingEnv, publicEnv } from './env';

export function billingConfig(): (BillingConfig & { webhookSecret: string }) | null {
  const e = billingEnv();
  if (!e) return null;
  return { stripe: new StripeClient({ secretKey: e.secretKey }), siteUrl: publicEnv().NEXT_PUBLIC_SITE_URL, meterEventName: e.meterEventName, automaticTax: e.automaticTax, webhookSecret: e.webhookSecret };
}
