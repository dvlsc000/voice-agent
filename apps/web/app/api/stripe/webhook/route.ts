import { NextResponse, type NextRequest } from 'next/server';
import { handleStripeEvent, verifyStripeSignature } from '@vp/server';
import { billingConfig } from '@/lib/billing';
import { serverDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  const cfg = billingConfig();
  if (!cfg) return NextResponse.json({ error: 'billing not configured' }, { status: 503 });
  const raw = await request.text(); // raw body: required for signature verification
  if (!verifyStripeSignature(raw, request.headers.get('stripe-signature'), cfg.webhookSecret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }
  try {
    const outcome = await handleStripeEvent(serverDb(), JSON.parse(raw), { siteUrl: cfg.siteUrl });
    return NextResponse.json({ received: true, outcome });
  } catch {
    return NextResponse.json({ error: 'processing failed' }, { status: 500 }); // Stripe retries
  }
}
